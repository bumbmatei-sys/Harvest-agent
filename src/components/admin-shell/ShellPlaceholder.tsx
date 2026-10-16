'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLACEHOLDER_COPY, type ShellPlaceholderId } from './shell-nav';

export function ShellPlaceholder({ id }: { id: ShellPlaceholderId }) {
  const copy = PLACEHOLDER_COPY[id];
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-0">
      <h1 className="font-display text-3xl font-light tracking-tight text-strong">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted">{copy.body}</p>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>Nothing here is live.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">{copy.body}</p>
        </CardContent>
      </Card>
    </div>
  );
}
