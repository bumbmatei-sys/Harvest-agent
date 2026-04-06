import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
 try {
 // In a real app, you would verify the user's token here
 // const authHeader = request.headers.get('Authorization');
 // if (!authHeader?.startsWith('Bearer ')) {
 // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 // }
 // const token = authHeader.split('Bearer ')[1];
 // await adminAuth.verifyIdToken(token);

 const snapshot = await adminDb.collection('churches').get();
 const churches = snapshot.docs.map(doc => ({
 id: doc.id,
 ...doc.data()
 }));

 return NextResponse.json({ churches });
 } catch (error) {
 console.error('Error fetching churches:', error);
 return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
 }
}

export async function POST(request: Request) {
 try {
 const body = await request.json();
 
 const docRef = await adminDb.collection('churches').add({
 ...body,
 createdAt: new Date().toISOString(),
 });

 return NextResponse.json({ success: true, id: docRef.id });
 } catch (error) {
 console.error('Error creating church:', error);
 return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
 }
}
