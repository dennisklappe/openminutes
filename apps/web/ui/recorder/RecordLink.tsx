import { PhoneIcon } from '../icons.js';
import { usePhoneConfig } from './hooks.js';

export function RecordLink({
  className,
  current = false,
}: {
  className: string;
  current?: boolean;
}) {
  const config = usePhoneConfig();
  if (!config?.enabled) return null;
  return (
    <a className={className} href="#/record" aria-current={current ? 'page' : undefined}>
      <PhoneIcon />
      <span>Record</span>
    </a>
  );
}
