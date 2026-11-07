<script lang="ts">
  import { icons, type IconName } from '../icons';

  interface Props {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    /** Accessible name. Without it the icon is decorative and hidden from screen readers. */
    label?: string;
    spin?: boolean;
    class?: string;
  }

  let { name, size = 16, strokeWidth = 2, label, spin = false, class: className = '' }: Props = $props();
</script>

<svg
  class="lc-icon {className}"
  class:spin
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {@html icons[name]}
</svg>

<style>
  .lc-icon {
    flex: none;
    display: inline-block;
    vertical-align: middle;
  }

  .spin {
    animation: lc-spin 0.9s linear infinite;
  }

  @keyframes lc-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 2.4s;
    }
  }
</style>
