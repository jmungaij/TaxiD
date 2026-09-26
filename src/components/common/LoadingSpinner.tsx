
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
}

const LoadingSpinner = ({ size = 24, className }: LoadingSpinnerProps) => {
  return (
    <div className={cn("flex justify-center items-center", className)}>
      <Loader2 size={size} className="animate-spin text-primary" />
    </div>
  );
};

export default LoadingSpinner;
