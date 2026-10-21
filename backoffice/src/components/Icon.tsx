/**
 * Icone Lucide (D127), incluse nel pacchetto: nessun file scaricato da servizi esterni. Sempre
 * decorative: il significato lo porta il testo accanto.
 */
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Download,
  Eye,
  Image,
  Pencil,
  Scale,
  Smartphone,
  TriangleAlert,
  Upload,
  X,
  Building2,
  ChartLine,
  Check,
  ChevronDown,
  Clock,
  Info,
  List,
  Lock,
  LogOut,
  MapPin,
  CalendarDays,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Ticket,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { IconName as SectionIcon } from '@/lib/roles';

const ICONS = {
  building: Building2,
  list: List,
  users: Users,
  shieldCheck: ShieldCheck,
  shield: Shield,
  scale: Scale,
  smartphone: Smartphone,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  download: Download,
  eye: Eye,
  image: Image,
  pencil: Pencil,
  alert: TriangleAlert,
  upload: Upload,
  close: X,
  ticket: Ticket,
  lock: Lock,
  chart: ChartLine,
  settings: Settings,
  bell: Bell,
  check: Check,
  chevronDown: ChevronDown,
  clock: Clock,
  info: Info,
  logOut: LogOut,
  mapPin: MapPin,
  calendar: CalendarDays,
  plus: Plus,
  search: Search,
  trash: Trash2,
} satisfies Record<SectionIcon, LucideIcon> & Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = ICONS[name];
  return (
    <Component
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
