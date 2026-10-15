import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCode({ value, size = 240, className = '' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [value, size]);
  return src ? <img className={`qr ${className}`} src={src} width={size} height={size} alt={`QR: ${value}`} /> : null;
}
