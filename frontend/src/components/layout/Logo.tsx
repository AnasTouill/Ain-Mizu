import { motion } from 'framer-motion';

const MARK = '/brand/ain-mizu-mark.png';
const FULL = '/brand/ain-mizu-logo.png';

/** Ain-Mizu emblem (water drop + leaf over the fields), cut from the official logo. */
export function Logo({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.img
      src={MARK}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className="shrink-0 select-none object-contain"
      style={{ width: size, height: size }}
      initial={animate ? { opacity: 0, scale: 0.85, rotate: -8 } : false}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

/** "AIN-MIZU" wordmark in the logo's navy with the teal "i". */
export function BrandWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-word whitespace-nowrap font-bold ${className}`} dir="ltr">
      AIN-M<span className="accent">i</span>ZU
    </span>
  );
}

/** Full logo with tagline (login, boot screen). Intrinsic size 495x440. */
export function FullLogo({ width = 220, className = '' }: { width?: number; className?: string }) {
  return (
    <img
      src={FULL}
      width={width}
      height={Math.round((width * 440) / 495)}
      alt="AIN-MIZU, optimal water distribution for agriculture"
      draggable={false}
      decoding="async"
      className={`select-none object-contain ${className}`}
      style={{ width, height: 'auto' }}
    />
  );
}
