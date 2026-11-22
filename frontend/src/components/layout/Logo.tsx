/** AIN MIZU badge (navy ring, rising sun, palms and waves). */
export function Logo({ size = 36 }: { size?: number }) {
  return <img src="/ain-mizu-logo.png" alt="AIN MIZU" width={size} height={size} className="shrink-0 rounded-full object-contain drop-shadow-[0_4px_10px_rgba(29,53,87,0.25)]" />;
}
