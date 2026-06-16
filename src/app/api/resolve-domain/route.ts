import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Resolve a custom domain to a tenantId using Firestore REST API.
 * No firebase-admin SDK needed — uses the web API key.
 * Looks up the 'domains' collection by document ID (the domain string).
 * Called by middleware when hostname doesn't match known base domains.
 */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain');
  const redirectPath = request.nextUrl.searchParams.get('redirect') || '/';
  
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  if (!domain) {
    return NextResponse.redirect(baseUrl);
  }

  try {
    // Use server-only env var for API key (falls back to NEXT_PUBLIC for local dev)
    const apiKey = process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    
    if (!apiKey || !projectId) {
      console.error('Missing FIREBASE_API_KEY or FIREBASE_PROJECT_ID env vars');
      return NextResponse.redirect(baseUrl);
    }
    
    // Normalize domain: lowercase, strip www. prefix for lookup
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    // Try exact match on domains collection (simple GET, only needs API key)
    let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/domains/${normalizedDomain}?key=${apiKey}`;
    let resp = await fetch(url);

    if (!resp.ok) {
      // Try with www prefix in case that's how it was stored
      url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/domains/www.${normalizedDomain}?key=${apiKey}`;
      resp = await fetch(url);
    }

    if (!resp.ok) {
      return NextResponse.redirect(baseUrl);
    }

    const doc = await resp.json();
    const tenantId = doc.fields?.tenantId?.stringValue;

    if (!tenantId) {
      return NextResponse.redirect(baseUrl);
    }

    // Redirect to the original path on the custom domain itself
    const redirectUrl = new URL(redirectPath, request.url);
    const response = NextResponse.redirect(redirectUrl);
    
    response.cookies.set('tenantId', tenantId, { 
      path: '/', 
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
    response.cookies.set('customDomain', domain, { 
      path: '/', 
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });

    return response;
  } catch (error) {
    console.error('Domain resolution error:', error);
    return NextResponse.redirect(baseUrl);
  }
}
