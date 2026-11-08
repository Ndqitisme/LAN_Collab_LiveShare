import { t } from '../shared/catalog.svelte';

export interface EmojiGroup {
  id: string;
  label: () => string;
  items: string[];
}

export const EMOJI: EmojiGroup[] = [
  {
    id: 'smileys',
    label: () => t('chat.emoji.smileys'),
    items: '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 😘 😋 😛 😜 🤪 🤗 🤔 🤨 😐 😑 😶 🙄 😏 😬 😌 😴 😷 🤒 🤯 😎 🤓 🧐 😕 😟 😮 😲 😳 🥺 😢 😭 😱 😤 😡 🤬'.split(' '),
  },
  {
    id: 'gestures',
    label: () => t('chat.emoji.gestures'),
    items: '👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👋 🤙 👉 👈 👆 👇 ☝️ ✋ 🤚 🖐️ 🫡 🤷 🤦 🙋 🙆 🙅 👀 🧠'.split(' '),
  },
  {
    id: 'work',
    label: () => t('chat.emoji.work'),
    items: '✅ ❌ ⚠️ ❓ ❗ 💡 🔥 🚀 🎯 🐛 🔧 🛠️ ⚙️ 🔍 📌 📎 📝 📄 📁 📊 💻 🖥️ ⌨️ 🖱️ 🧪 🔒 🔑 ⏳ ⏰ 📅 ☕ 🍜'.split(' '),
  },
  {
    id: 'symbols',
    label: () => t('chat.emoji.symbols'),
    items: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✨ ⭐ 🌟 🎉 🎊 🏆 🥇 👑 💎 🎁 🌈 ☀️ 🌙 ⚡ 💤 💬 💭 🔔 ➕ ➖ ✔️ ➡️ ⬅️ 🔁'.split(' '),
  },
];

export const RECENT_MAX = 24;
