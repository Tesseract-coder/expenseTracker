import { CircleHelp } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/EmptyState';

export function NotFoundPage() {
  return (
    <EmptyState icon={CircleHelp} title="Page not found">
      <Link to="/" className="font-medium text-primary underline">
        Go home
      </Link>
    </EmptyState>
  );
}
