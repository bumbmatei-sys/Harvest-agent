import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemberAvatar } from './PostPresentation';
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarBadge: () => null,
}));
describe('member avatar', () => {
  it('requests author and comment photos without a referrer', () => {
    for (const small of [false, true]) {
      expect(renderToStaticMarkup(<MemberAvatar name="Alice" photo="https://example.com/a" small={small} />)).toContain('referrerPolicy="no-referrer"');
    }
  });
});
