<script lang="ts">
  import qrcode from 'qrcode-generator';

  interface Props {
    text: string;
    label: string;
    size?: number;
  }

  let { text, label, size = 220 }: Props = $props();

  // Quiet zone of four modules, as the QR specification asks for scanners to lock on.
  const QUIET = 4;

  const qr = $derived.by(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const n = code.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (code.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { n, d };
  });
</script>

<svg
  class="qr"
  role="img"
  aria-label={label}
  width={size}
  height={size}
  viewBox="{-QUIET} {-QUIET} {qr.n + QUIET * 2} {qr.n + QUIET * 2}"
  shape-rendering="crispEdges"
>
  <rect x={-QUIET} y={-QUIET} width={qr.n + QUIET * 2} height={qr.n + QUIET * 2} fill="#fff" />
  <path d={qr.d} fill="#000" />
</svg>

<style>
  .qr {
    display: block;
    border-radius: var(--lc-radius-md);
  }
</style>
