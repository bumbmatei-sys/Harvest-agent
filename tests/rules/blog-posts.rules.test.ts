import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedDoc, teardownEnv,
  superAdmin, owner, rosterAdmin, member, adminB, asUid, seedAdmin,
  permsOnly,
  TENANT_A,
} from './helpers';

/**
 * blog_posts, the preview-token collection, and the super-admin audit trail.
 *
 * A client used to be able to create, update and delete a post when it held
 * writeArticles. Those writes now belong to the blog service (Admin SDK).
 * The read stays: a member of the ministry can still open a post.
 */

const T = TENANT_A;
const post = { tenantId: T, title: 'Hello', content: 'x', authorId: 'a' };

beforeAll(async () => {
  await getEnv();
  await seedBase();
  await seedAdmin('articles-admin', TENANT_A, permsOnly('writeArticles'));
  await seedAdmin('full-sentinel', TENANT_A, { ...permsOnly(), fullAccess: true });
});

afterAll(async () => {
  await teardownEnv();
});

describe('blog_posts client writes are closed', () => {
  async function contexts() {
    return [
      ['articles permission', await asUid('articles-admin')],
      ['full access', await asUid('full-sentinel')],
      ['owner', await owner()],
      ['roster admin', await rosterAdmin()],
      ['super admin', await superAdmin()],
      ['member', await member()],
      ['other ministry', await adminB()],
    ] as const;
  }

  it('nobody can create, update or delete a post from the client', async () => {
    for (const [label, ctx] of await contexts()) {
      const db = ctx.firestore();
      await assertFails(db.doc(`blog_posts/create-${label.replace(/\s/g, '-')}`).set(post));
      await seedDoc('blog_posts/locked-post', post);
      await assertFails(db.doc('blog_posts/locked-post').update({ title: 'Edited' }));
      await assertFails(db.doc('blog_posts/locked-post').delete());
    }
  });

  it('a member of the ministry can still read a post, and another ministry cannot', async () => {
    await seedDoc('blog_posts/readable', post);
    await assertSucceeds((await member()).firestore().doc('blog_posts/readable').get());
    await assertFails((await adminB()).firestore().doc('blog_posts/readable').get());
  });

  it('a client cannot read or write a confirm token or an audit row', async () => {
    const db = (await superAdmin()).firestore();
    await assertFails(db.doc('blog_confirm_tokens/tok').set({ consumed: false }));
    await assertFails(db.doc('blog_confirm_tokens/tok').get());
    await assertFails(db.doc('blog_admin_audit/evt').set({ action: 'schedule' }));
    await assertFails(db.doc('blog_admin_audit/evt').get());
    const holder = (await asUid('articles-admin')).firestore();
    await assertFails(holder.doc('blog_confirm_tokens/tok').set({ consumed: false }));
    await assertFails(holder.doc('blog_admin_audit/evt').get());
  });
});

describe('full access still does not reopen blog_posts', () => {
  it('fullAccess true with every specific flag false cannot write a post', async () => {
    const perms = permsOnly();
    perms.fullAccess = true;
    await seedAdmin('sentinel-blog', TENANT_A, perms);
    const db = (await asUid('sentinel-blog')).firestore();
    await assertFails(db.doc('blog_posts/sentinel-denied').set(post));
  });
});
