import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

/**
 * Password prompt for protected PDF statements. The password lives only in this component's
 * state for the one decrypt call: it is never saved, logged or sent to the server.
 */
export function PdfPasswordStep({
  fileName,
  error,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  error?: string | undefined;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <div className="flex items-start gap-3">
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="text-sm text-muted-foreground">
            This statement is password-protected. Banks usually use your customer ID, or part of
            your name and date of birth — check the e-mail it came with.
          </p>
        </div>
      </div>
      <Field label="PDF password" htmlFor="pdf-password" error={error}>
        <Input
          id="pdf-password"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          value={password}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        The file is unlocked on this device only. The password is never saved or sent; Kharcha keeps
        the original, still-locked PDF with the import.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!password}>
          Unlock
        </Button>
      </div>
    </form>
  );
}
