export const themes = [
  { id: 'light', label: 'Sáng' },
  { id: 'dark', label: 'Tối' },
  { id: 'vscode-dark', label: 'VS Code tối' },
  { id: 'vscode-hc', label: 'VS Code tương phản cao' },
] as const;

export type GalleryTheme = (typeof themes)[number]['id'];
