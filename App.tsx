import { StatusBar } from 'expo-status-bar';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  Dimensions,
  SafeAreaView,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  PanResponder,
  Animated,
  RefreshControl,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

const SCREEN_WIDTH = Dimensions.get('window').width;
const NUM_COLS = 3;
const CELL_WIDTH = Math.floor(SCREEN_WIDTH / NUM_COLS);
const CELL_HEIGHT = Math.floor(CELL_WIDTH * (5 / 4));
const ACCOUNTS_KEY = 'ig_accounts';

type PostKind = 'draft' | 'posted';
type AccountKind = 'online' | 'offline';
type GridItem = { id: string; uri: string; kind: PostKind; timestamp?: string };
type Account = { id: string; username: string; kind: AccountKind; token?: string };

async function fetchIGUser(token: string): Promise<{ id: string; username: string }> {
  const res = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function fetchIGPosts(token: string): Promise<GridItem[]> {
  const res = await fetch(
    `https://graph.instagram.com/me/media?fields=id,media_url,thumbnail_url,media_type,media_product_type,timestamp&limit=32&access_token=${token}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.data as any[])
    .filter((p) => p.media_product_type !== 'REELS' && (p.thumbnail_url || p.media_url))
    .map((p) => ({
      id: p.id,
      uri: p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url,
      kind: 'posted' as PostKind,
      timestamp: p.timestamp,
    }))
    .filter((p) => !!p.uri);
}

async function loadAccounts(): Promise<Account[]> {
  const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveAccounts(accounts: Account[]) {
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function pickFromLibrary() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access to continue.');
    return null;
  }
  return ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftsByAccount, setDraftsByAccount] = useState<Record<string, GridItem[]>>({});
  const [postedByAccount, setPostedByAccount] = useState<Record<string, GridItem[]>>({});
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState(0);
  const [viewingItem, setViewingItem] = useState<GridItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showOnlineSetup, setShowOnlineSetup] = useState(false);
  const [showOfflineSetup, setShowOfflineSetup] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [nameInput, setNameInput] = useState('');

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState(-1);
  const dragPos = useRef(new Animated.ValueXY()).current;
  const dragRef = useRef<{ item: GridItem; fromDraftIndex: number; overDraftIndex: number } | null>(null);
  const gridPageY = useRef(0);
  const scrollY = useRef(0);
  const gridViewRef = useRef<View>(null);

  const activeAccount = accounts.find((a) => a.id === activeId) ?? null;
  const isOffline = activeAccount?.kind === 'offline';
  const drafts: GridItem[] = activeId ? (draftsByAccount[activeId] ?? []) : [];
  const posted: GridItem[] = activeId ? (postedByAccount[activeId] ?? []) : [];
  const allItems: GridItem[] = [...drafts, ...posted];

  useEffect(() => {
    loadAccounts().then((saved) => {
      if (saved.length > 0) {
        setAccounts(saved);
        setActiveId(saved[0].id);
        saved.filter((a) => a.kind === 'online' && a.token).forEach((a) => fetchPostsForAccount(a));
      }
    });
  }, []);

  const fetchPostsForAccount = useCallback(async (account: Account, silent = false) => {
    if (!account.token) return;
    if (!silent) setLoading(true);
    try {
      const posts = await fetchIGPosts(account.token);
      setPostedByAccount((prev) => ({ ...prev, [account.id]: posts }));
      setFailedIds(new Set());
      setFetchedAt(Date.now());
    } catch (e: any) {
      Alert.alert(`Error (${account.username})`, e.message ?? 'Could not fetch posts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    if (!activeAccount || activeAccount.kind !== 'online') return;
    setRefreshing(true);
    fetchPostsForAccount(activeAccount, true);
  }, [activeAccount, fetchPostsForAccount]);

  const connectOnlineAccount = useCallback(async () => {
    const t = tokenInput.trim();
    if (!t) return;
    setLoading(true);
    setShowOnlineSetup(false);
    try {
      const user = await fetchIGUser(t);
      if (accounts.find((a) => a.id === user.id)) {
        Alert.alert('Already connected', `@${user.username} is already added.`);
        setTokenInput('');
        return;
      }
      const newAccount: Account = { id: user.id, username: user.username, kind: 'online', token: t };
      const posts = await fetchIGPosts(t);
      const updated = [...accounts, newAccount];
      await saveAccounts(updated);
      setAccounts(updated);
      setActiveId(user.id);
      setPostedByAccount((prev) => ({ ...prev, [user.id]: posts }));
      setFetchedAt(Date.now());
      setTokenInput('');
    } catch (e: any) {
      Alert.alert('Connection failed', e.message ?? 'Could not connect to Instagram.');
      setShowOnlineSetup(true);
    } finally {
      setLoading(false);
    }
  }, [tokenInput, accounts]);

  const createOfflineAccount = useCallback(async () => {
    const name = nameInput.trim();
    if (!name) return;
    const newAccount: Account = { id: `offline_${Date.now()}`, username: name, kind: 'offline' };
    const updated = [...accounts, newAccount];
    await saveAccounts(updated);
    setAccounts(updated);
    setActiveId(newAccount.id);
    setNameInput('');
    setShowOfflineSetup(false);
  }, [nameInput, accounts]);

  const removeAccount = useCallback((accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    Alert.alert(`Remove ${account?.username}?`, 'This will also clear their drafts and posts.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const updated = accounts.filter((a) => a.id !== accountId);
          await saveAccounts(updated);
          setAccounts(updated);
          setDraftsByAccount((prev) => { const n = { ...prev }; delete n[accountId]; return n; });
          setPostedByAccount((prev) => { const n = { ...prev }; delete n[accountId]; return n; });
          setActiveId(updated[0]?.id ?? null);
          setShowSwitcher(false);
        },
      },
    ]);
  }, [accounts]);

  const switchAccount = useCallback((id: string) => {
    setActiveId(id);
    setViewingItem(null);
    setFailedIds(new Set());
    setShowSwitcher(false);
  }, []);

  const pickDrafts = useCallback(async () => {
    if (!activeId) return;
    const result = await pickFromLibrary();
    if (!result || result.canceled) return;
    const newItems: GridItem[] = result.assets.map((a) => ({
      id: a.uri + Date.now() + Math.random(), uri: a.uri, kind: 'draft',
    }));
    setDraftsByAccount((prev) => ({ ...prev, [activeId]: [...newItems, ...(prev[activeId] ?? [])] }));
  }, [activeId]);

  const pickPosted = useCallback(async () => {
    if (!activeId) return;
    const result = await pickFromLibrary();
    if (!result || result.canceled) return;
    const newItems: GridItem[] = result.assets.map((a) => ({
      id: a.uri + Date.now() + Math.random(), uri: a.uri, kind: 'posted',
    }));
    setPostedByAccount((prev) => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), ...newItems] }));
  }, [activeId]);

  const showAddOptions = useCallback(() => {
    if (!activeId) return;
    if (isOffline) {
      Alert.alert('Add photos', undefined, [
        { text: 'Add as Draft', onPress: pickDrafts },
        { text: 'Add as Posted', onPress: pickPosted },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      pickDrafts();
    }
  }, [activeId, isOffline, pickDrafts, pickPosted]);

  const removeDraft = useCallback((id: string) => {
    if (!activeId) return;
    setDraftsByAccount((prev) => ({ ...prev, [activeId]: (prev[activeId] ?? []).filter((d) => d.id !== id) }));
    setViewingItem(null);
  }, [activeId]);

  const removePostedOffline = useCallback((id: string) => {
    if (!activeId) return;
    setPostedByAccount((prev) => ({ ...prev, [activeId]: (prev[activeId] ?? []).filter((p) => p.id !== id) }));
    setViewingItem(null);
  }, [activeId]);

  const moveDraft = useCallback((id: string, dir: -1 | 1) => {
    if (!activeId) return;
    setDraftsByAccount((prev) => {
      const list = [...(prev[activeId] ?? [])];
      const idx = list.findIndex((d) => d.id === id);
      const next = idx + dir;
      if (next < 0 || next >= list.length) return prev;
      [list[idx], list[next]] = [list[next], list[idx]];
      return { ...prev, [activeId]: list };
    });
  }, [activeId]);

  // PanResponder for drag (created once, reads mutable refs)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => dragRef.current !== null,
      onPanResponderMove: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        dragPos.setValue({ x: pageX - CELL_WIDTH / 2, y: pageY - CELL_HEIGHT / 2 });
        const relX = pageX;
        const relY = pageY - gridPageY.current + scrollY.current;
        const col = Math.max(0, Math.min(NUM_COLS - 1, Math.floor(relX / CELL_WIDTH)));
        const row = Math.max(0, Math.floor(relY / CELL_HEIGHT));
        const idx = Math.min(row * NUM_COLS + col, allItemsRef.current.length - 1);
        if (dragRef.current) dragRef.current.overDraftIndex = idx;
        setDropIndex(idx);
      },
      onPanResponderRelease: () => {
        const dr = dragRef.current;
        const aid = activeIdRef.current;
        if (!dr || !aid) { setIsDragging(false); setDragItemId(null); dragRef.current = null; return; }
        const targetItem = allItemsRef.current[Math.max(0, Math.min(dr.overDraftIndex, allItemsRef.current.length - 1))];
        if (targetItem?.kind === 'draft' && targetItem.id !== dr.item.id) {
          setDraftsByAccount((prev) => {
            const list = [...(prev[aid] ?? [])];
            const fromIdx = list.findIndex((d) => d.id === dr.item.id);
            const toIdx = list.findIndex((d) => d.id === targetItem.id);
            if (fromIdx >= 0 && toIdx >= 0) {
              const [removed] = list.splice(fromIdx, 1);
              list.splice(toIdx, 0, removed);
            }
            return { ...prev, [aid]: list };
          });
        }
        dragRef.current = null;
        setIsDragging(false);
        setDragItemId(null);
        setDropIndex(-1);
      },
      onPanResponderTerminate: () => {
        dragRef.current = null;
        setIsDragging(false);
        setDragItemId(null);
        setDropIndex(-1);
      },
    })
  ).current;

  // Refs to give panResponder access to latest state without recreating it
  const allItemsRef = useRef(allItems);
  useEffect(() => { allItemsRef.current = allItems; }, [allItems]);
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const handleLongPress = useCallback((item: GridItem, index: number, pageX: number, pageY: number) => {
    if (item.kind !== 'draft') return;
    dragRef.current = { item, fromDraftIndex: index, overDraftIndex: index };
    dragPos.setValue({ x: pageX - CELL_WIDTH / 2, y: pageY - CELL_HEIGHT / 2 });
    setIsDragging(true);
    setDragItemId(item.id);
    setDropIndex(index);
    gridViewRef.current?.measure((_x, _y, _w, _h, px, py) => { gridPageY.current = py; });
  }, []);

  const dragItem = allItems.find((i) => i.id === dragItemId);

  const renderGridCell = (item: GridItem, index: number) => {
    const isDraft = item.kind === 'draft';
    const failed = failedIds.has(item.id);
    const isBeingDragged = item.id === dragItemId;
    const isDropTarget = isDragging && dropIndex === index && isDraft && !isBeingDragged;

    return (
      <TouchableOpacity
        key={item.id}
        activeOpacity={isDraft ? 0.7 : 0.85}
        style={[
          styles.cell,
          isBeingDragged && styles.cellGhost,
          isDropTarget && styles.cellDropTarget,
        ]}
        onPress={() => !failed && !isDragging && setViewingItem(item)}
        onLongPress={(evt) => handleLongPress(item, index, evt.nativeEvent.pageX, evt.nativeEvent.pageY)}
        delayLongPress={250}
      >
        {failed ? (
          <View style={styles.failedCell}>
            <Text style={styles.failedIcon}>⚠️</Text>
            <Text style={styles.failedText}>Expired</Text>
            {!isDraft && <TouchableOpacity onPress={onRefresh}><Text style={styles.failedRefresh}>Refresh</Text></TouchableOpacity>}
          </View>
        ) : (
          <Image
            key={`${item.id}-${item.kind === 'posted' ? fetchedAt : 0}`}
            source={{ uri: item.uri }}
            style={[styles.cellImage, isBeingDragged && { opacity: 0.3 }]}
            onError={() => setFailedIds((prev) => new Set(prev).add(item.id))}
          />
        )}
        <View style={[styles.badge, isDraft ? styles.badgeDraft : styles.badgePosted]}>
          <Text style={styles.badgeText}>{isDraft ? 'DRAFT' : 'POSTED'}</Text>
        </View>
        {isDraft && !isBeingDragged && (
          <View style={styles.dragHandle}>
            <Text style={styles.dragHandleText}>⠿</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowSwitcher(true)} style={styles.accountPill}>
          <Text style={styles.accountHandle} numberOfLines={1}>
            {activeAccount ? `${isOffline ? '📱' : '📸'} ${activeAccount.username}` : 'Grid Preview'}
          </Text>
          <Text style={styles.accountChevron}>▾</Text>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {activeAccount?.kind === 'online' && (
            <TouchableOpacity style={styles.iconBtn} onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.iconBtnText}>{refreshing ? '…' : '↻'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={showAddOptions}>
            <Text style={styles.iconBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>{drafts.length} draft{drafts.length !== 1 ? 's' : ''}</Text>
        <Text style={styles.statDot}>·</Text>
        <Text style={styles.stat}>{posted.length} posted</Text>
        {drafts.length > 0 && <><Text style={styles.statDot}>·</Text><Text style={styles.statHint}>hold to drag drafts</Text></>}
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={styles.loadingText}>Fetching posts…</Text>
        </View>
      )}

      {allItems.length === 0 && !loading ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🖼️</Text>
          <Text style={styles.emptyTitle}>Your grid preview is empty</Text>
          <Text style={styles.emptySubtext}>
            {accounts.length === 0 ? 'Tap your name above to add an account' : isOffline ? 'Tap + to add posted photos or drafts' : 'Tap + to add drafts'}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            scrollEnabled={!isDragging}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            refreshControl={
              activeAccount?.kind === 'online'
                ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                : undefined
            }
          >
            <View
              ref={gridViewRef}
              style={styles.grid}
              onLayout={() => {
                gridViewRef.current?.measure((_x, _y, _w, _h, _px, py) => { gridPageY.current = py; });
              }}
            >
              {allItems.map((item, index) => renderGridCell(item, index))}
            </View>
          </ScrollView>

          {/* Transparent overlay captures pan during drag */}
          {isDragging && (
            <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
          )}

          {/* Floating dragged item */}
          {isDragging && dragItem && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.floatingCell,
                { transform: [{ translateX: dragPos.x }, { translateY: dragPos.y }] },
              ]}
            >
              <Image source={{ uri: dragItem.uri }} style={styles.cellImage} />
            </Animated.View>
          )}
        </View>
      )}

      {/* Full-screen viewer */}
      <Modal visible={!!viewingItem} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.viewerBackdrop}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewingItem(null)}>
            <Text style={styles.viewerCloseText}>✕</Text>
          </TouchableOpacity>
          {viewingItem && (
            <>
              <Image source={{ uri: viewingItem.uri }} style={styles.viewerImage} resizeMode="contain" />
              {viewingItem.kind === 'draft' && (
                <View style={styles.viewerControls}>
                  <TouchableOpacity style={styles.viewerBtn} onPress={() => { moveDraft(viewingItem.id, -1); setViewingItem(null); }}>
                    <Text style={styles.viewerBtnText}>← Move earlier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.viewerBtn, styles.viewerBtnDelete]} onPress={() => removeDraft(viewingItem.id)}>
                    <Text style={styles.viewerBtnText}>Remove</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.viewerBtn} onPress={() => { moveDraft(viewingItem.id, 1); setViewingItem(null); }}>
                    <Text style={styles.viewerBtnText}>Move later →</Text>
                  </TouchableOpacity>
                </View>
              )}
              {viewingItem.kind === 'posted' && isOffline && (
                <View style={styles.viewerControls}>
                  <TouchableOpacity style={[styles.viewerBtn, styles.viewerBtnDelete, { flex: 0, paddingHorizontal: 24 }]} onPress={() => removePostedOffline(viewingItem.id)}>
                    <Text style={styles.viewerBtnText}>Remove posted photo</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* Account switcher */}
      <Modal visible={showSwitcher} animationType="slide" transparent>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowSwitcher(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Accounts</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {accounts.map((a) => (
                <TouchableOpacity key={a.id} style={styles.accountRow} onPress={() => switchAccount(a.id)}>
                  <View style={styles.accountAvatar}>
                    <Text style={styles.accountAvatarText}>{a.username[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accountRowName}>{a.username}</Text>
                    <Text style={styles.accountRowKind}>{a.kind === 'online' ? '📸 Instagram' : '📱 Offline'}</Text>
                  </View>
                  {a.id === activeId && <Text style={styles.accountRowCheck}>✓</Text>}
                  <TouchableOpacity onPress={() => removeAccount(a.id)} style={styles.accountRemoveBtn}>
                    <Text style={styles.accountRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.connectBtn} onPress={() => { setShowSwitcher(false); setShowModeSelect(true); }}>
              <Text style={styles.connectBtnText}>+ Add Account</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSwitcher(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Mode select */}
      <Modal visible={showModeSelect} animationType="slide" transparent>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowModeSelect(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add Account</Text>
            <Text style={styles.modalBody}>How do you want to set up this account?</Text>
            <TouchableOpacity style={styles.modeCard} onPress={() => { setShowModeSelect(false); setShowOnlineSetup(true); }}>
              <Text style={styles.modeCardIcon}>📸</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeCardTitle}>Online — Instagram</Text>
                <Text style={styles.modeCardDesc}>Connect your Instagram account to automatically load your posts.</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modeCard} onPress={() => { setShowModeSelect(false); setShowOfflineSetup(true); }}>
              <Text style={styles.modeCardIcon}>📱</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeCardTitle}>Offline — Manual</Text>
                <Text style={styles.modeCardDesc}>Pick photos from your camera roll. No Instagram account needed.</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModeSelect(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Online setup */}
      <Modal visible={showOnlineSetup} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Connect Instagram</Text>
            <Text style={styles.modalBody}>Generate an access token at developers.facebook.com → your app → Instagram → API setup.{'\n\n'}Your token is stored securely on device only.</Text>
            <TextInput style={styles.tokenInput} placeholder="Paste your access token here" placeholderTextColor="#aaa" value={tokenInput} onChangeText={setTokenInput} autoCapitalize="none" autoCorrect={false} multiline />
            <TouchableOpacity style={[styles.connectBtn, !tokenInput.trim() && styles.connectBtnDisabled]} onPress={connectOnlineAccount} disabled={!tokenInput.trim()}>
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowOnlineSetup(false); setTokenInput(''); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Offline setup */}
      <Modal visible={showOfflineSetup} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Offline Account</Text>
            <Text style={styles.modalBody}>Enter a name for this account. You'll manually add your posted photos and drafts from your camera roll.</Text>
            <TextInput style={styles.tokenInput} placeholder="e.g. My Instagram, Travel Account…" placeholderTextColor="#aaa" value={nameInput} onChangeText={setNameInput} autoCapitalize="words" autoCorrect={false} />
            <TouchableOpacity style={[styles.connectBtn, !nameInput.trim() && styles.connectBtnDisabled]} onPress={createOfflineAccount} disabled={!nameInput.trim()}>
              <Text style={styles.connectBtnText}>Create</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowOfflineSetup(false); setNameInput(''); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#dbdbdb',
  },
  accountPill: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  accountHandle: { fontSize: 18, fontWeight: '700', color: '#000', flexShrink: 1 },
  accountChevron: { fontSize: 12, color: '#555', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: '#fff', fontSize: 18, lineHeight: 22, fontWeight: '400' },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, gap: 6 },
  stat: { fontSize: 12, color: '#555', fontWeight: '500' },
  statDot: { fontSize: 12, color: '#bbb' },
  statHint: { fontSize: 12, color: '#aaa' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 13, color: '#555' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL_WIDTH, height: CELL_HEIGHT, borderWidth: 0.5, borderColor: '#fff', position: 'relative', overflow: 'hidden' },
  cellGhost: { opacity: 0.4 },
  cellDropTarget: { borderWidth: 2, borderColor: '#000', opacity: 0.8 },
  cellImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  badge: { position: 'absolute', bottom: 3, left: 3, borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  badgeDraft: { backgroundColor: 'rgba(0,0,0,0.65)' },
  badgePosted: { backgroundColor: 'rgba(99,99,99,0.55)' },
  badgeText: { color: '#fff', fontSize: 7, fontWeight: '700', letterSpacing: 0.4 },
  dragHandle: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  dragHandleText: { color: '#fff', fontSize: 10 },
  floatingCell: {
    position: 'absolute', width: CELL_WIDTH, height: CELL_HEIGHT,
    borderRadius: 4, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 12,
    elevation: 12,
  },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#262626', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#8e8e8e', textAlign: 'center', lineHeight: 18 },
  viewerBackdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 20, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  viewerCloseText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  viewerImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * (5 / 4) },
  viewerControls: { position: 'absolute', bottom: 48, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  viewerBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  viewerBtnDelete: { backgroundColor: 'rgba(255,77,77,0.3)' },
  viewerBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  modalBody: { fontSize: 13, color: '#555', lineHeight: 20 },
  modeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 14, padding: 16 },
  modeCardIcon: { fontSize: 28, marginTop: 2 },
  modeCardTitle: { fontSize: 15, fontWeight: '700', color: '#000', marginBottom: 4 },
  modeCardDesc: { fontSize: 13, color: '#666', lineHeight: 18 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  accountAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  accountRowName: { fontSize: 15, fontWeight: '500', color: '#000' },
  accountRowKind: { fontSize: 11, color: '#888', marginTop: 1 },
  accountRowCheck: { fontSize: 16, color: '#000', fontWeight: '700' },
  accountRemoveBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  accountRemoveText: { fontSize: 12, color: '#ff4d4d', fontWeight: '500' },
  tokenInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 13, color: '#000', minHeight: 70, textAlignVertical: 'top' },
  connectBtn: { backgroundColor: '#000', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  connectBtnDisabled: { backgroundColor: '#ccc' },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { color: '#666', fontSize: 14 },
  failedCell: { width: '100%', height: '100%', backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center', gap: 4 },
  failedIcon: { fontSize: 18 },
  failedText: { fontSize: 10, color: '#888' },
  failedRefresh: { fontSize: 10, color: '#000', fontWeight: '600', textDecorationLine: 'underline' },
});
