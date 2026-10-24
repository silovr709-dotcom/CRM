// QR-код ссылки: клиент наводит камеру телефона и сразу видит статус заказа.
import { useEffect, useState } from 'react';

export default function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // Библиотека QR нужна редко — грузим её отдельным файлом, чтобы не
    // утяжелять основное приложение.
    import('qrcode')
      .then((module) => module.default.toDataURL(value, { margin: 1, width: size, errorCorrectionLevel: 'M' }))
      .then((data) => { if (alive) setSrc(data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [value, size]);

  if (failed) {
    return <p className="inline-note">QR не получился — скопируйте ссылку и отправьте её сообщением.</p>;
  }

  return (
    <div className="qr-box">
      {src
        ? <img src={src} width={size} height={size} alt="QR-код со ссылкой на статус заказа" />
        : <div className="qr-loading" style={{ width: size, height: size }} aria-hidden="true" />}
      <span className="muted small">Наведите камеру телефона</span>
    </div>
  );
}
