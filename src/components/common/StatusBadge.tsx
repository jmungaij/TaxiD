
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toneClasses, type StatusTone } from '@/lib/design/statusTone';

type StatusType = 
  | 'active' | 'inactive' | 'blocked'  // Rider statuses
  | 'available' | 'busy' | 'offline'   // Driver statuses
  | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';  // Trip statuses

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

/** Canonical status → tokenized tone mapping (shared with StatusBorder). */
const STATUS_TONE_MAP: Record<StatusType, { tone: StatusTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'warning', label: 'Inactive' },
  blocked: { tone: 'danger', label: 'Blocked' },
  available: { tone: 'success', label: 'Available' },
  busy: { tone: 'info', label: 'Busy' },
  offline: { tone: 'neutral', label: 'Offline' },
  scheduled: { tone: 'accent', label: 'Scheduled' },
  in_progress: { tone: 'info', label: 'In Progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
};

const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const config = STATUS_TONE_MAP[status] ?? { tone: 'neutral' as StatusTone, label: String(status) };
  const t = toneClasses(config.tone);
  const live = status === 'in_progress' || status === 'busy' || status === 'available' || status === 'active';

  return (
    <Badge
      variant="outline"
      data-status-tone={config.tone}
      className={cn(
        "gap-1.5 font-medium border-0 rounded-full pl-2 pr-2.5 py-0.5 ring-1 ring-inset",
        t.bg,
        t.text,
        t.ring,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full bg-current", live && "animate-ai-pulse motion-reduce:animate-none")}
      />
      {config.label}
    </Badge>
  );

};

export default StatusBadge;
