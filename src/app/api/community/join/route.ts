import { NextRequest } from 'next/server';
import { communityMembershipRequest } from '@/lib/community-membership-api';

export const dynamic = 'force-dynamic';
export const POST = (request: NextRequest) => communityMembershipRequest(request, true);
