import onionBrandMark from '../assets/onion-brand/Onion_logo_mark_v2.png';

const MAIN_LOGO_COLOR = '#2563EB';

const OnionBrandIcon = ({ size = 22, className = '', label = 'Onion Flows' }) => (
  <span
    role="img"
    aria-label={label}
    className={`inline-block shrink-0 ${className}`}
    style={{
      width: size,
      height: size,
      backgroundColor: MAIN_LOGO_COLOR,
      WebkitMaskImage: `url(${onionBrandMark})`,
      maskImage: `url(${onionBrandMark})`,
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
    }}
  />
);

export default OnionBrandIcon;
