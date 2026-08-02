import onionAiMark from '../assets/onion-brand/Onion_ai_mark_v1.png';

const OnionAiIcon = ({ size = 18, className = '', label = '' }) => (
  <img
    src={onionAiMark}
    width={size}
    height={size}
    alt={label}
    aria-hidden={label ? undefined : 'true'}
    className={`shrink-0 object-contain ${className}`}
    draggable="false"
  />
);

export default OnionAiIcon;
