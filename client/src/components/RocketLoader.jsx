import { motion, useReducedMotion } from 'framer-motion';
import rocketAsset from '../assets/onion-rocket-minimal.png';

const smokeShapeA = 'M600 0 C500 165 230 470 0 760 Q600 675 1200 760 C970 470 700 165 600 0 Z';
const smokeParticles = [
  { x: -13, drift: -8, size: 5, distance: 58, duration: 0.92, delay: 0 },
  { x: 10, drift: 7, size: 7, distance: 72, duration: 1.08, delay: 0.16 },
  { x: -5, drift: -3, size: 9, distance: 88, duration: 1.2, delay: 0.34 },
  { x: 16, drift: 10, size: 4, distance: 52, duration: 0.82, delay: 0.48 },
  { x: -18, drift: -11, size: 6, distance: 78, duration: 1.14, delay: 0.62 },
  { x: 3, drift: 4, size: 8, distance: 96, duration: 1.28, delay: 0.78 },
];
const sideSmokePuffs = [
  { left: '43%', top: '18%', size: 'clamp(48px, 6vw, 104px)', delay: 0 },
  { left: '57%', top: '18%', size: 'clamp(54px, 6.5vw, 112px)', delay: 0.18 },
  { left: '35%', top: '34%', size: 'clamp(80px, 9vw, 164px)', delay: 0.36 },
  { left: '65%', top: '34%', size: 'clamp(74px, 8.5vw, 154px)', delay: 0.54 },
  { left: '24%', top: '54%', size: 'clamp(112px, 13vw, 224px)', delay: 0.72 },
  { left: '76%', top: '54%', size: 'clamp(120px, 14vw, 238px)', delay: 0.9 },
  { left: '12%', top: '76%', size: 'clamp(150px, 18vw, 310px)', delay: 1.08 },
  { left: '88%', top: '76%', size: 'clamp(158px, 19vw, 324px)', delay: 1.26 },
];

const RocketLoader = ({ label = 'Iniciando ambiente' }) => {
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#02030b]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(124,58,237,0.18),transparent_25%),linear-gradient(180deg,#03040d_0%,#050316_100%)]"
      />

      <div
        aria-hidden="true"
        className="absolute bottom-[8%] left-1/2 z-10 h-0 w-0 -translate-x-1/2"
      >
        <motion.div
          className="relative h-0 w-0"
          initial={reduceMotion ? { y: '-70vh' } : { y: '0vh' }}
          animate={{ y: '-70vh' }}
          transition={reduceMotion
            ? { duration: 0 }
            : { duration: 3.25, ease: [0.22, 0.76, 0.24, 1] }}
        >
        <div className="absolute left-1/2 top-2 h-[84vh] w-[122vw] min-w-[880px] max-w-none -translate-x-1/2 overflow-visible">
          <motion.svg
            viewBox="0 0 1200 760"
            preserveAspectRatio="none"
            className="h-full w-full origin-top overflow-visible"
            animate={reduceMotion ? undefined : {
              scaleY: [0.99, 1.018, 0.99],
            }}
            transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformOrigin: '600px 0px' }}
          >
            <defs>
              <linearGradient id="giantSmoke" x1="600" y1="0" x2="600" y2="760" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="0.1" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="0.46" stopColor="#ffffff" stopOpacity="0.72" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient id="giantSmokeCore" x1="600" y1="0" x2="600" y2="700" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.82" />
                <stop offset="0.2" stopColor="#ffffff" stopOpacity="0.28" />
                <stop offset="0.75" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="smokeEdge" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.06" />
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
              </linearGradient>
              <filter id="giantSmokeGlow" x="-15%" y="-10%" width="130%" height="130%">
                <feGaussianBlur stdDeviation="18" />
              </filter>
            </defs>

            <motion.path
              d={smokeShapeA}
              fill="#ffffff"
              opacity="0.2"
              filter="url(#giantSmokeGlow)"
              animate={reduceMotion ? undefined : { opacity: [0.16, 0.24, 0.16] }}
              transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.path
              d={smokeShapeA}
              fill="url(#giantSmoke)"
            />
            <motion.path
              d="M600 0 C565 120 490 315 440 690 Q600 650 760 690 C710 315 635 120 600 0 Z"
              fill="url(#giantSmokeCore)"
              animate={reduceMotion ? undefined : {
                opacity: [0.5, 0.86, 0.5],
                scaleX: [0.92, 1.06, 0.92],
              }}
              transition={{ duration: 0.78, repeat: Infinity, ease: 'easeInOut' }}
              style={{ transformOrigin: '600px 0px' }}
            />
            <motion.path
              d={smokeShapeA}
              fill="none"
              stroke="url(#smokeEdge)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              animate={reduceMotion ? undefined : {
                opacity: [0.46, 0.8, 0.46],
              }}
              transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.svg>

          {!reduceMotion && sideSmokePuffs.map((puff, index) => (
            <div
              key={index}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: puff.left, top: puff.top, width: puff.size, height: puff.size }}
            >
              <motion.span
                className="block h-full w-full rounded-full bg-white shadow-[0_0_22px_rgba(255,255,255,0.34)]"
                initial={{ y: 12, scale: 0.72, opacity: 0 }}
                animate={{
                  y: [12, -8, -18],
                  scale: [0.72, 1.08, 1.22],
                  opacity: [0, 0.72, 0],
                }}
                transition={{
                  duration: 1.55,
                  delay: puff.delay,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            </div>
          ))}
        </div>

        <motion.span
          className="absolute left-1/2 top-0 z-10 h-8 w-[2px] origin-top -translate-x-1/2 bg-gradient-to-b from-white via-white to-transparent shadow-[0_0_10px_rgba(255,255,255,0.9)]"
          animate={reduceMotion ? undefined : {
            scaleY: [0.68, 1.2, 0.68],
          }}
          transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut' }}
        />

          {!reduceMotion && smokeParticles.map((particle, index) => (
            <motion.span
              key={index}
              className="absolute top-3 z-10 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.72)]"
              style={{
                left: particle.x,
                width: particle.size,
                height: particle.size,
              }}
              initial={{ x: 0, y: 0, scale: 0.45, opacity: 0 }}
              animate={{
                x: [0, particle.drift],
                y: [0, particle.distance],
                scale: [0.45, 1, 1.65],
                opacity: [0, 0.95, 0],
              }}
              transition={{
                duration: particle.duration,
                delay: particle.delay,
                repeat: Infinity,
                ease: 'easeOut',
              }}
            />
          ))}

          <div className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2">
            <motion.img
              src={rocketAsset}
              alt=""
              draggable="false"
              className="block w-[42px] max-w-none select-none"
              style={{
                opacity: 1,
                filter: 'brightness(0) invert(1) drop-shadow(0 0 1px #020617) drop-shadow(0 0 10px rgba(255,255,255,0.72))',
              }}
              animate={reduceMotion ? undefined : { rotate: [-0.65, 0.65, -0.65] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      </div>

      <div className="absolute inset-x-0 bottom-[4.5%] z-30 flex justify-center px-6">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-violet-100/75">
          <span>{label}</span>
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                className="h-1 w-1 rounded-full bg-violet-100"
                animate={reduceMotion ? undefined : { opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
                transition={{ duration: 1, repeat: Infinity, delay: index * 0.16 }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
};

export default RocketLoader;
