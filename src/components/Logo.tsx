/** 站点标志：气泡（词）里一个加号（加），渐变底；顶栏、登录页、图标共用一套形状（public/icons、src/app/icon.svg 是同一图形的文件版） */
export default function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs><linearGradient id="aiword-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f6df5" /><stop offset="1" stopColor="#7c5cff" /></linearGradient></defs>
      <rect width="64" height="64" rx="14" fill="url(#aiword-logo-g)" />
      <rect x="11" y="13" width="42" height="32" rx="9" fill="#fff" />
      <path d="M19 43 L15.5 53.5 L28 43 Z" fill="#fff" />
      <rect x="29.5" y="20" width="5" height="18" rx="2.5" fill="url(#aiword-logo-g)" />
      <rect x="23" y="26.5" width="18" height="5" rx="2.5" fill="url(#aiword-logo-g)" />
    </svg>
  );
}
