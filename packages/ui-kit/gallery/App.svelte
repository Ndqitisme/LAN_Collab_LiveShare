<script lang="ts">
  import {
    Avatar,
    Badge,
    Button,
    Card,
    Checkbox,
    CodeBlock,
    Dialog,
    EmptyState,
    Icon,
    IconButton,
    Input,
    List,
    ProgressBar,
    Select,
    StatusDot,
    Switch,
    Tabs,
    Textarea,
    Toast,
    Tooltip,
    VirtualList,
    icons,
    type IconName,
  } from '../src/index';
  import { themes, type GalleryTheme } from './themes';

  let { theme }: { theme: GalleryTheme } = $props();

  function switchTheme(id: string) {
    const url = new URL(location.href);
    url.searchParams.set('theme', id);
    location.href = url.href;
  }

  let hubAddress = $state('192.168.1.10:8200');
  let token = $state('');
  let note = $state('');
  let project = $state('');
  let autoConnect = $state(true);
  let autoSave = $state(false);
  let notify = $state(true);
  let allFiles = $state(false);
  let someFiles = $state(true);
  let dialogOpen = $state(false);
  let tab = $state('members');
  let segment = $state('day');
  let selectedProject = $state<string | null>('web-portal');
  let following = $state(false);

  const members = [
    { id: 'u1', name: 'Nguyễn Minh Anh', color: '#e5484d', status: 'live', doing: 'Đang sửa src/app/router.ts' },
    { id: 'u2', name: 'Trần Quốc Bảo', color: '#30a46c', status: 'live', doing: 'Đang debug test/sync.test.js' },
    { id: 'u3', name: 'Lê Thu Hà', color: '#8e4ec6', status: 'connecting', doing: 'Đang kết nối lại' },
    { id: 'u4', name: 'quy@BDT-NDQUY', color: '#f76b15', status: 'offline', doing: 'Mất kết nối 5 phút trước' },
  ] as const;

  const projects = [
    { id: 'web-portal', name: 'web-portal', path: 'D:\\du-an\\web-portal', members: 4 },
    { id: 'bao-cao-quy', name: 'bao-cao-quy', path: 'D:\\du-an\\bao-cao-quy', members: 2 },
    { id: 'data-pipeline', name: 'data-pipeline', path: 'E:\\work\\data-pipeline', members: 0 },
  ];

  const authors = ['Minh Anh', 'Quốc Bảo', 'Thu Hà', 'quy'];
  const files = ['src/app/router.ts', 'lib/client-core.js', 'README.md', 'test/sync.test.js', 'docs/protocol.md'];
  const history = Array.from({ length: 500 }, (_, i) => ({
    id: 500 - i,
    author: authors[i % authors.length],
    file: files[(i * 7) % files.length],
    time: `${String(17 - Math.floor(i / 60)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}`,
  }));

  const iconNames = Object.keys(icons) as IconName[];
  const invite = 'LC3-K7QF-2M9X-HB4T-8WZP-RC6N';
</script>

<header class="gallery-header">
  <div class="gallery-title">
    <Icon name="server" size={18} />
    <h1>LAN Collab UI kit</h1>
    <span>0.2.0</span>
  </div>
  <Tabs variant="pill" label="Giao diện" items={themes.map((t) => ({ id: t.id, label: t.label }))} value={theme} onchange={switchTheme} />
</header>

<main class="gallery-grid">
  <Card title="Button" description="Bốn kiểu, ba cỡ, trạng thái đang xử lý và vô hiệu">
    <div class="stack">
      <div class="row">
        <Button variant="primary" icon="plug">Kết nối</Button>
        <Button>Sao chép mã mời</Button>
        <Button variant="ghost">Huỷ</Button>
        <Button variant="danger" icon="trash-2">Xoá dự án</Button>
      </div>
      <div class="row">
        <Button size="sm">Nhỏ</Button>
        <Button>Vừa</Button>
        <Button size="lg" variant="primary" iconEnd="chevron-right">Tiếp tục</Button>
      </div>
      <div class="row">
        <Button variant="primary" loading>Đang kết nối</Button>
        <Button disabled>Đồng bộ</Button>
        <Button variant="primary" disabled>Gửi</Button>
      </div>
    </div>
  </Card>

  <Card title="IconButton" description="Luôn có nhãn cho trình đọc màn hình">
    <div class="row">
      <IconButton icon="refresh-cw" label="Kết nối lại" />
      <IconButton icon="copy" label="Sao chép mã mời" />
      <IconButton icon="settings" label="Cài đặt" />
      <IconButton icon="eye" label="Đi theo" pressed={following} onclick={() => (following = !following)} />
      <IconButton icon="send" label="Gửi" variant="primary" />
      <IconButton icon="ellipsis" label="Thêm" variant="secondary" />
      <IconButton icon="refresh-cw" label="Đang tải" loading />
      <IconButton icon="trash-2" label="Xoá" disabled />
    </div>
  </Card>

  <Card title="Input" description="Nhãn, gợi ý, lỗi và vô hiệu">
    <div class="stack">
      <Input label="Địa chỉ LAN Hub" bind:value={hubAddress} hint="Dạng IP:cổng, ví dụ 192.168.1.10:8200" mono />
      <Input label="Token" type="password" bind:value={token} placeholder="Dán token từ LAN Hub" error="Token không đúng với LAN Hub này." />
      <Input icon="search" placeholder="Tìm thành viên" aria-label="Tìm thành viên" />
      <Input label="Tên dự án" value="web-portal" disabled />
    </div>
  </Card>

  <Card title="Textarea và Select">
    <div class="stack">
      <Textarea label="Trạng thái" bind:value={note} placeholder="Đang làm gì" autoresize rows={2} maxlength={120} />
      <Select
        label="Dự án"
        bind:value={project}
        placeholder="Chọn dự án"
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        hint="LAN Hub đang phục vụ 3 dự án."
      />
      <Select label="Mạng" value="lan" options={[{ value: 'lan', label: 'Mạng nội bộ' }]} disabled />
    </div>
  </Card>

  <Card title="Switch và Checkbox">
    <div class="stack">
      <Switch bind:checked={autoConnect} label="Tự kết nối khi mở thư mục" />
      <Switch bind:checked={autoSave} label="Tự lưu" description="Lưu file 0,4 giây sau mỗi thay đổi." />
      <Switch checked label="Đồng bộ thư mục node_modules" disabled />
      <Checkbox bind:checked={notify} label="Báo khi có tin nhắn mới" />
      <Checkbox bind:checked={allFiles} bind:indeterminate={someFiles} label="Chọn tất cả file xung đột" description="2 trên 5 file đã chọn." />
      <Checkbox label="Gửi kèm nhật ký" disabled />
    </div>
  </Card>

  <Card title="Badge">
    <div class="stack">
      <div class="row">
        <Badge>Chưa kết nối</Badge>
        <Badge tone="accent">Đang đồng bộ</Badge>
        <Badge tone="ok" icon="check">Đã đồng bộ</Badge>
        <Badge tone="warn">3 xung đột</Badge>
        <Badge tone="danger">Sai token</Badge>
      </div>
      <div class="row">
        <Badge variant="solid">4</Badge>
        <Badge variant="solid" tone="danger">12</Badge>
        <Badge variant="outline" tone="accent">v2</Badge>
        <Badge variant="outline">chỉ đọc</Badge>
      </div>
    </div>
  </Card>

  <Card title="Avatar và StatusDot" description="Màu thành viên do LAN Hub cấp" padding="sm">
    <List items={[...members]} key={(m) => m.id} dense={false}>
      {#snippet row(m)}
        <div class="member">
          <Avatar name={m.name} color={m.color} status={m.status} />
          <div class="member-text">
            <strong>{m.name}</strong>
            <span>{m.doing}</span>
          </div>
        </div>
      {/snippet}
    </List>
    <div class="row" style="padding: var(--lc-space-2)">
      <StatusDot status="live" label="Đã kết nối" />
      <StatusDot status="connecting" label="Đang kết nối lại" />
      <StatusDot status="offline" label="Ngoại tuyến" />
      <StatusDot status="error" label="Cần xử lý" />
    </div>
  </Card>

  <Card title="Tooltip">
    <div class="row tooltip-demo">
      <Tooltip text="Sao chép mã mời" align="start" open>
        <IconButton icon="copy" label="Sao chép mã mời" variant="secondary" />
      </Tooltip>
      <Tooltip text="Mã mời có chứa token. Chỉ gửi cho thành viên trong nhóm." placement="bottom">
        <Button icon="info" variant="ghost">Rê chuột để xem</Button>
      </Tooltip>
    </div>
  </Card>

  <Card title="Toast">
    <div class="stack">
      <Toast
        tone="danger"
        title="Không kết nối được LAN Hub tại 192.168.1.10:8200"
        message="Cổng không phản hồi sau 3 giây."
        onclose={() => {}}
      >
        {#snippet actions()}
          <Button size="sm" variant="primary" icon="stethoscope">Chẩn đoán</Button>
          <Button size="sm">Thử lại</Button>
        {/snippet}
      </Toast>
      <Toast tone="ok" title="Đã đồng bộ 128 file" message="Dự án web-portal khớp với bản trên hub." onclose={() => {}} />
      <Toast tone="warn" title="3 file đã đổi ở cả hai nơi" message="Chọn bản trên hub hoặc bản trên máy này cho từng file." />
    </div>
  </Card>

  <Card title="Dialog" description="Escape đóng hộp thoại và trả focus về nút đã mở">
    <div class="row">
      <Button id="open-dialog" icon="log-out" onclick={() => (dialogOpen = true)}>Ngắt kết nối</Button>
    </div>
    <Dialog bind:open={dialogOpen} title="Ngắt kết nối khỏi web-portal?" description="Các thay đổi chưa gửi được giữ trên máy này và gửi lên khi kết nối lại.">
      <Checkbox label="Tắt tự kết nối cho thư mục này" />
      {#snippet footer()}
        <Button variant="ghost" onclick={() => (dialogOpen = false)}>Huỷ</Button>
        <Button variant="primary" onclick={() => (dialogOpen = false)}>Ngắt kết nối</Button>
      {/snippet}
    </Dialog>
  </Card>

  <Card title="Tabs">
    <div class="stack">
      <Tabs
        label="Bảng điều khiển"
        bind:value={tab}
        items={[
          { id: 'members', label: 'Thành viên', icon: 'users', count: 4 },
          { id: 'history', label: 'Lịch sử', icon: 'history' },
          { id: 'chat', label: 'Chat', icon: 'message-square', count: 12 },
          { id: 'logs', label: 'Nhật ký', disabled: true },
        ]}
      >
        {#snippet children(id)}
          <p class="muted" style="margin: 0">Nội dung của thẻ {id}.</p>
        {/snippet}
      </Tabs>
      <Tabs
        variant="pill"
        label="Khoảng thời gian"
        bind:value={segment}
        items={[
          { id: 'hour', label: '1 giờ' },
          { id: 'day', label: 'Hôm nay' },
          { id: 'week', label: '7 ngày' },
        ]}
      />
    </div>
  </Card>

  <Card title="List" description="Chọn bằng chuột hoặc phím mũi tên" padding="sm">
    <List items={projects} key={(p) => p.id} bind:selected={selectedProject} label="Dự án">
      {#snippet row(p)}
        <Icon name="folder" size={16} />
        <div class="member-text" style="flex: 1">
          <strong>{p.name}</strong>
          <span>{p.path}</span>
        </div>
        {#if p.members}<Badge>{p.members} thành viên</Badge>{:else}<Badge variant="outline">trống</Badge>{/if}
      {/snippet}
    </List>
  </Card>

  <Card title="VirtualList" description="500 lượt chỉnh sửa, chỉ vẽ các dòng đang thấy" padding="sm">
    <div class="virtual-frame">
      <VirtualList items={history} rowHeight={36} height="288px" key={(h) => h.id} label="Lịch sử lượt chỉnh sửa">
        {#snippet row(h)}
          <div class="history-row">
            <code>#{h.id}</code>
            <span>{h.author} · {h.file}</span>
            <code>{h.time}</code>
          </div>
        {/snippet}
      </VirtualList>
    </div>
  </Card>

  <Card title="ProgressBar">
    <div class="stack">
      <ProgressBar label="Đang đồng bộ web-portal" value={0.3} detail="12/40 file" />
      <ProgressBar label="Đang tìm LAN Hub trong mạng nội bộ" />
      <ProgressBar label="Đã tải bản trên hub" value={1} tone="ok" />
      <ProgressBar value={0.72} size="sm" tone="warn" />
    </div>
  </Card>

  <Card title="EmptyState" padding="none">
    <EmptyState icon="message-square" title="Chưa có tin nhắn" description="Tin nhắn gửi trong dự án hiện ở đây.">
      {#snippet actions()}
        <Button size="sm" icon="plug" variant="primary">Kết nối</Button>
      {/snippet}
    </EmptyState>
  </Card>

  <Card title="CodeBlock">
    <div class="stack">
      <CodeBlock label="Mã mời" code={invite} />
      <CodeBlock label="PowerShell" code={'lanhub-cli --root D:\\du-an\\web-portal --port 8200'} wrap />
    </div>
  </Card>

  <Card title="Card" description="Tiêu đề, mô tả, hành động và chân thẻ">
    {#snippet actions()}
      <Badge tone="ok">Đang chạy</Badge>
      <IconButton icon="ellipsis" label="Thêm" size="sm" />
    {/snippet}
    <p style="margin: 0">LAN Hub phục vụ 3 dự án trên cổng 8200. 6 thành viên đang kết nối.</p>
    {#snippet footer()}
      <Button size="sm" variant="ghost">Xem nhật ký</Button>
      <Button size="sm" variant="primary">Mở LAN Hub</Button>
    {/snippet}
  </Card>

  <Card title="Icon" description="Bộ Lucide nhúng sẵn, giấy phép ISC" class="wide">
    <div class="icon-grid">
      {#each iconNames as name (name)}
        <div class="icon-cell" title={name}>
          <Icon {name} size={18} />
          <span>{name}</span>
        </div>
      {/each}
    </div>
  </Card>
</main>
