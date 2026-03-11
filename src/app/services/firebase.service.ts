
import { Injectable, inject, runInInjectionContext, Injector } from '@angular/core';
import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User, PhoneAuthProvider, linkWithCredential, RecaptchaVerifier, updateProfile } from '@angular/fire/auth';
import { Firestore, doc, setDoc, getDoc, addDoc, collection, query, where, orderBy, limit, getDocs, updateDoc, deleteDoc, writeBatch, deleteField } from '@angular/fire/firestore';
import { onSnapshot, Unsubscribe } from '@firebase/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { CloudinaryService } from './cloudinary.service';

/**
 * FirebaseService: central data layer for auth + Firestore + storage.
 * Sections: types, identity helpers, auth/account lifecycle, profile/roles/security, flashcards/activities,
 *           progress/sessions/stats sync, media (video memories), category match, custom categories/cards,
 *           trusted contacts & patients.
 */

// ─── Data types (interfaces) ─────────────────────────────────────────────────
// Shared shapes for user/profile/progress/sessions/cards used by the service API.
interface UserData {
  email: string;
  createdAt: string;
  name?: string;
  photo?: string;
  lastLoginAt?: string;
  role?: 'patient' | 'caregiver' | 'standard';
  securityCode?: string;
  caregiverPassword?: string;
  caregiverPasswordSetAt?: number;
  patientInfo?: {
    name: string;
    age?: number;
    gender?: string;
    condition?: string;
    dateOfBirth?: string;
    medicalId?: string;
    notes?: string;
  };
  caregiverInfo?: {
    name: string;
    relationship?: string;
    contactEmail?: string;
    contactPhone?: string;
    notes?: string;
  };
}

interface CategoryMatchSession {
  id: string;
  timestamp: string;
  correct: number;
  total: number;
  accuracy: number;
}

interface UserProgress {
  overallStats: {
    accuracy: number;
    avgTimePerCard: number;
    totalCards: number;
    skippedCards: number;
  };
  categoryStats: {
    name: string;
    icon: string;
    accuracy: number;
    cardsPlayed: number;
    avgTime: number;
  }[];
  categoryMatch: {
    sessions: { [sessionId: string]: CategoryMatchSession };
    totalSessions: number;
    overallAccuracy: number;
  };
  lastCalculated: string;
  
  accuracyOverTime?: {
    today: number;
    week: number;
    month: number;
    allTime: number;
  };
  recentSessions?: any[];
  totalSessions?: number;
}

interface GameSession {
  category: string;
  correctAnswers: number;
  totalQuestions: number;
  totalTime: number;
  skipped: number;
  timestamp: string;
}

interface UserCategory {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  createdAt: number;
  userId: string;
}

interface UserCard {
  id: string;
  categoryId: string;
  userId: string;
  type: 'photo' | 'video' | 'manual';
  src: string;
  label?: string;
  audio?: string | null;
  duration?: number;
  createdAt: number;
}

interface TrustedContact {
  id: string;
  patientUserId: string;
  caregiverUserId: string;
  patientName?: string;
  caregiverName?: string;
  patientEmail?: string;
  caregiverEmail?: string;
  createdAt: string;
  createdBy: string;
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
 
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private injector = inject(Injector);
  private cloudinaryService = inject(CloudinaryService);

  constructor() {
  }

  private getCaregiverId(): string | null {
    return this.getCurrentUser()?.uid ?? null;
  }

  private getPatientId(override?: string): string | null {
    if (override) return override;
    const selectedPatientId = localStorage.getItem('selectedPatientId');
    if (selectedPatientId) return selectedPatientId;
    return this.getCurrentUser()?.uid ?? null;
  }

  // ─── Authentication & account lifecycle ─────────────────────────────────────
  // Login/signup, phone OTP, logout, current user resolution, and password reset.
  async login(email: string, password: string): Promise<User> {
    const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
    return userCredential.user;
  }
//create caregiver account
  async signup(
    email: string,
    password: string,
    name?: string,
    phoneNumber?: string,
    patientInfo?: {
      name: string;
      age?: number;
      gender?: string;
      condition?: string;
      dateOfBirth?: string;
      medicalId?: string;
      notes?: string;
    },
    caregiverInfo?: {
      name: string;
      relationship?: string;
      contactEmail?: string;
      contactPhone?: string;
      notes?: string;
    }
  ): Promise<User> {
    
    if (!email || typeof email !== 'string') {
      throw new Error('Valid email is required');
    }
    if (!password || typeof password !== 'string') {
      throw new Error('Valid password is required');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('Valid name is required');
    }
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Valid phone number is required');
    }

    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new Error('Invalid email format');
    }

    
    const phoneDigitsOnly = phoneNumber.replace(/\D/g, '');
    if (phoneDigitsOnly.length < 10) {
      throw new Error('Phone number must have at least 10 digits');
    }

    
    if (name.trim().length === 0) {
      throw new Error('Name cannot be empty');
    }

    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
    } catch (error: any) {
      
      throw error;
    }

    const uid = userCredential.user.uid;

    try {
      
      const securityCode = await this.generateUniqueSecurityCode();

      
      const userData: UserData = {
        email: email.trim(),
        createdAt: new Date().toISOString(),
        name: name.trim(),
        role: 'standard',
        securityCode,
        
        patientInfo: patientInfo ? this.sanitizeForFirestore(patientInfo) as any : undefined,
        caregiverInfo: caregiverInfo ? this.sanitizeForFirestore(caregiverInfo) as any : undefined
      };

      await setDoc(doc(this.firestore, 'caregiver', uid), this.sanitizeForFirestore({ ...userData, phoneNumber: phoneNumber.trim() }));

      
      await this.createSecurityCodeEntry(uid, securityCode, { email: email.trim(), name: name.trim() });

      
      try { await updateProfile(userCredential.user, { displayName: name.trim() }); } catch {}

      
      await this.initializeUserProgress(uid);

      return userCredential.user;
    } catch (firestoreError: any) {
      
      console.error('Firestore write failed during signup, rolling back Auth user:', firestoreError);
      try {
        await userCredential.user.delete();
        console.log('Auth user deleted due to Firestore failure');
      } catch (deleteError) {
        console.error('Failed to delete Auth user after Firestore error:', deleteError);
      }
      
      throw firestoreError;
    }
  }

  
  async startPhoneOTP(phoneNumber: string, containerId = 'recaptcha-container'): Promise<string> {
    const auth = this.auth as any;
    const mod = await import('@angular/fire/auth');
    
    const verifier = new mod.RecaptchaVerifier(auth, containerId, { size: 'invisible' }) as RecaptchaVerifier;
    const confirmation = await mod.signInWithPhoneNumber(auth, phoneNumber, verifier as any);
    return confirmation.verificationId;
  }

  
  async verifyPhoneOTP(verificationId: string, code: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    const cred = PhoneAuthProvider.credential(verificationId, code);
    await linkWithCredential(user, cred as any);
    
    try {
      const phoneNumber = (user.phoneNumber || null) as any;
      await updateDoc(doc(this.firestore, 'caregiver', user.uid), this.sanitizeForFirestore({ phoneNumber }));
    } catch {}
  }

  //create patient
  async savePatientDetails(details: { name: string; age?: number; sex?: string; relationship?: string; notes?: string; emergencyContact?: string }, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    const patientDetailsRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'patientInfo', 'details');
    await setDoc(patientDetailsRef, {
      name: details.name,
      age: details.age || null,
      sex: details.sex || null,
      relationship: details.relationship || null,
      notes: details.notes || null,
      emergencyContact: details.emergencyContact || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }

  
  async saveAdditionalUserDetails(details: { fullName?: string; phoneNumber?: string; address?: string; secondaryEmail?: string; notes?: string; preferredLanguage?: string }): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    await setDoc(doc(this.firestore, 'caregiver', user.uid), this.sanitizeForFirestore({ additional: details, phoneNumber: details.phoneNumber || undefined }), { merge: true });
  }

  // ─── Flashcards & activities ────────────────────────────────────────────────
  // Create/read/subscribe/update/delete flashcards (structured + legacy paths) and activity progress tracking.
  
  async createFlashcard(
    card: Omit<UserCard, 'id' | 'userId' | 'createdAt'> &
      { type: 'photo' | 'video' | 'manual'; category?: 'people' | 'places' | 'objects' | 'custom-category' | 'photo-memories'; categoryId?: string }
  ): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    
    const profile = await this.getUserProfile(user.uid);
    if (profile?.role === 'patient') {
      throw new Error('Patients cannot create content');
    }

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');

    const cardId = `card_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const data: any = this.sanitizeForFirestore({
      id: cardId,
      caregiverId: cgId,
      patientId: pid,
      createdAt: Date.now(),
      ...card
    });

    
    const builtinCategory = (card as any).category as string | undefined;
    const customCategoryId = (card as any).categoryId as string | undefined;

    if (builtinCategory && ['people','places','objects','custom-category','photo-memories'].includes(builtinCategory)) {
      await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', builtinCategory, 'cards', cardId), data);
    } else if (customCategoryId) {
      
      await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'custom-category', 'cards', cardId), this.sanitizeForFirestore({ ...data, categoryId: customCategoryId }));
    } else {
      
      await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'photo-memories', 'cards', cardId), data);
    }

    
    const activities = [
      { id: `nameThatMemory_${cardId}`, type: 'nameThatMemory', cardId },
      { id: `categoryMatch_${cardId}`, type: 'categoryMatch', cardId }
    ];

    for (const a of activities) {
      const activityDoc = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities', a.id);
      await setDoc(activityDoc, this.sanitizeForFirestore({
        id: a.id,
        type: a.type,
        cardId: a.cardId,
        createdAt: Date.now()
      }));
    }

    
    try {
      
    } catch (e) {
      console.warn('Failed to cache flashcard locally (cache disabled):', e);
    }

    return cardId;
  }

  
  subscribeToFlashcards(onChange: (cards: any[]) => void): Unsubscribe {
    const uid = this.getCurrentUser()?.uid || localStorage.getItem('userId') || '';
    if (!uid) throw new Error('User not authenticated');
    const categories = ['people','places','objects','custom-category','photo-memories'];
    const unsubs: Unsubscribe[] = [];
    const latest: Record<string, any[]> = {};
    const emit = () => {
      const merged = Object.values(latest).flat();
      
      const mapped = merged.map((d: any) => ({
        id: d.id,
        label: d.label,
        src: d.src || d.image,
        image: d.image || d.src,
        audio: d.audio,
        category: (d.category || d._bucket || '').toString(),
        createdAt: d.createdAt || Date.now(),
      }));
      
      const seen = new Set<string>();
      const unique = mapped.filter(c => { const k = `${(c.label||'').toLowerCase()}::${c.src||''}`; if (seen.has(k)) return false; seen.add(k); return true; });
      unique.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(unique);
    };
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) { console.warn('subscribeToFlashcards: no auth available'); return () => {}; }
    for (const cat of categories) {
      const qy = query(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', cat, 'cards'), orderBy('createdAt', 'desc'));
      const u = onSnapshot(qy, (snap) => {
        latest[cat] = snap.docs.map(d => ({ _bucket: cat, ...(d.data() as any) }));
        emit();
      });
      unsubs.push(u);
    }
    return () => { unsubs.forEach(u => { try { u(); } catch {} }); };
  }

  
  subscribeToGameFlashcards(onChange: (cards: Array<{ id: string; label: string; image: string; category: string; audio?: string; duration?: number; createdAt?: number }>) => void): Unsubscribe {
    let uid = this.getCurrentUser()?.uid || localStorage.getItem('userId') || '';
    if (!uid) { console.warn('subscribeToGameFlashcards: no UID available yet; will no-op.'); return () => {}; }
    const cats: Array<'people' | 'places' | 'objects'> = ['people','places','objects'];
    const unsubs: Unsubscribe[] = [];
    const latest: Record<string, any[]> = {};
    const emit = () => {
      const merged = Object.values(latest).flat().map((d: any) => ({ id: d.id, label: d.label, image: d.src || d.image, audio: d.audio || undefined, duration: d.duration || 0, category: (d.category || '').toString(), createdAt: d.createdAt }))
        .filter((c: any) => !!c.label && !!c.image);
      const seen = new Set<string>();
      const unique = merged.filter((c: any) => { const k = `${c.category}::${c.label.toLowerCase()}::${c.image}`; if (seen.has(k)) return false; seen.add(k); return true; });
      unique.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onChange(unique as any);
    };
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) { console.warn('subscribeToGameFlashcards: no auth available'); return () => {}; }
    for (const cat of cats) {
      const qStructured = query(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', cat, 'cards'), orderBy('createdAt', 'desc'));
      const u1 = onSnapshot(qStructured, (snap) => {
        latest[cat] = snap.docs.map(d => {
          const data = d.data() as any;
          return { ...data, id: data?.id || d.id };
        });
        emit();
      }, (err) => { console.warn('structured snapshot error', err); });
      unsubs.push(u1);
    }
    return () => { unsubs.forEach(u => { try { u(); } catch {} }); };
  }

  
  async getGameFlashcardsOnce(): Promise<Array<{ id: string; label: string; image: string; category: string; audio?: string; duration?: number; createdAt?: number }>> {
    const uid = this.getCurrentUser()?.uid || localStorage.getItem('userId') || '';
    if (!uid) return [];
    const out: any[] = [];
    const cats: Array<'people' | 'places' | 'objects'> = ['people','places','objects'];
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) return [];
    for (const cat of cats) {
      try {
        const structured = await getDocs(query(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', cat, 'cards'), orderBy('createdAt', 'desc')));
        structured.docs.forEach(d => {
          const data = d.data() as any;
          out.push({ ...data, id: data?.id || d.id, category: cat });
        });
      } catch (e) {
        console.warn('getGameFlashcardsOnce structured read error for', cat, e);
      }
    }
    const mapped = out
      .map((d: any) => ({ id: d.id, label: d.label, image: d.src || d.image, audio: d.audio || undefined, duration: d.duration || 0, category: (d.category || '').toString(), createdAt: d.createdAt }))
      .filter((c: any) => !!c.label && !!c.image);
    const seen = new Set<string>();
    const unique = mapped.filter((c: any) => { const k = `${c.category}::${c.label.toLowerCase()}::${c.image}`; if (seen.has(k)) return false; seen.add(k); return true; });
    unique.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return unique as any;
  }

  getCachedGameFlashcards(): Array<{ id: string; label: string; image: string; category: string; createdAt?: number }> {
    try {
      return [];
    } catch { return []; }
  }

  

  
  async addActivityProgress(activityId: string, progress: { correct: number; total: number; durationSec?: number; timestamp?: number }, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    const p = this.sanitizeForFirestore({
      correct: Number(progress.correct) || 0,
      total: Number(progress.total) || 0,
      durationSec: progress.durationSec ?? null,
      timestamp: progress.timestamp ?? Date.now(),
      accuracy: (Number(progress.total) > 0) ? Number(progress.correct) / Number(progress.total) : 0
    });

    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities', activityId, 'progress', id), p);
  }

  
  private sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
    const out: any = {};
    Object.keys(obj || {}).forEach(k => {
      const v = (obj as any)[k];
      if (v === undefined) return; 
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this.sanitizeForFirestore(v);
      } else {
        out[k] = v === undefined ? null : v;
      }
    });
    return out;
  }

  private async generateUniqueSecurityCode(): Promise<string> {
    
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const length = 8;
    const generate = () => Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

    
    while (true) {
      const candidate = generate();
      
      
      const securityCodesQuery = query(collection(this.firestore, 'securityCodes'), where('code', '==', candidate));
      const securityCodesSnap = await getDocs(securityCodesQuery);
      
      
      const usersQuery = query(collection(this.firestore, 'caregiver'), where('securityCode', '==', candidate));
      const usersSnap = await getDocs(usersQuery);
      
      if (securityCodesSnap.empty && usersSnap.empty) return candidate;
      
    }
  }

  async logout(): Promise<void> {
    
    try {
      const lastUid = localStorage.getItem('userId');
      localStorage.removeItem('gameSessions'); 
      if (lastUid) localStorage.removeItem(`gameSessions:${lastUid}`);
      localStorage.removeItem('patientDetails'); 
      ['peopleCards','placesCards','objectsCards'].forEach(k => localStorage.removeItem(k));
    } catch {}

    await signOut(this.auth);
  }

  getCurrentUser(): User | null {
    
    
    const storedUserId = localStorage.getItem('userId');
    const isLoggedIn = localStorage.getItem('userLoggedIn') === 'true';
    
    
    
    if (isLoggedIn && storedUserId) {
      const firebaseUser = this.auth.currentUser;
      
      
      
      if (!firebaseUser || firebaseUser.uid !== storedUserId) {
        
        
        return null;
      }
      
      return firebaseUser;
    }
    
    return this.auth.currentUser;
  }

  
  async sendPasswordReset(email: string): Promise<void> {
    const auth = this.auth;
    
    const mod = await import('@angular/fire/auth');
    await mod.sendPasswordResetEmail(auth as any, email);
  }

  async getUserData(uid: string) {
    const docRef = doc(this.firestore, 'caregiver', uid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  }

  // ─── Profile/roles & security ───────────────────────────────────────────────
  // User profile reads/updates, role switching, security code helpers, and caregiver password management.
  

  
  async updateUserProfile(profileData: {
    role?: 'patient' | 'caregiver' | 'standard';
    patientInfo?: {
      name: string;
      dateOfBirth?: string;
      medicalId?: string;
      notes?: string;
    };
    caregiverInfo?: {
      name: string;
      relationship?: string;
      contactPhone?: string;
      notes?: string;
    };
  }): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const updates: Partial<UserData> = {
      ...profileData,
      lastLoginAt: new Date().toISOString()
    };

    await updateDoc(doc(this.firestore, 'caregiver', user.uid), updates);
  }

  
  async getUserProfile(uid?: string): Promise<UserData | null> {
    const user = this.getCurrentUser();
    const storedUserId = localStorage.getItem('userId');
    
    
    const targetUid = uid || user?.uid || storedUserId;

    if (!targetUid) throw new Error('User not authenticated');

    const docRef = doc(this.firestore, 'caregiver', targetUid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() as UserData : null;
  }

  
  async setAsPatient(patientInfo: {
    name: string;
    dateOfBirth?: string;
    medicalId?: string;
    notes?: string;
  }): Promise<void> {
    await this.updateUserProfile({
      role: 'patient',
      patientInfo
    });
  }

  
  async setAsCaregiver(caregiverInfo: {
    name: string;
    relationship?: string;
    contactPhone?: string;
    notes?: string;
  }): Promise<void> {
    await this.updateUserProfile({
      role: 'caregiver',
      caregiverInfo
    });
  }

  
  async setAsStandard(): Promise<void> {
    await this.updateUserProfile({
      role: 'standard'
    });
  }

  // ─── Progress/sessions & stats sync ─────────────────────────────────────────
  // Game sessions storage/subscription, userProgress document, initialization, stats update, and local caching helpers.
  
  async saveGameSession(sessionData: Omit<GameSession, 'timestamp'>): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const gameSession: GameSession = {
      ...sessionData,
      timestamp: new Date().toISOString()
    };

    
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');
    await addDoc(
      collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats', 'gameSessions'),
      gameSession
    );

    
    try {
      const pid = this.getPatientId();
      const localKey = `gameSessions_${pid || user.uid}`;
      const localSessions = JSON.parse(localStorage.getItem(localKey) || '[]');
      localSessions.push(gameSession);
      localStorage.setItem(localKey, JSON.stringify(localSessions));
    } catch (e) {
      console.warn('Failed to cache game session locally:', e);
    }
  }

  async getUserGameSessions(userId?: string): Promise<GameSession[]> {
    const cgId = this.getCaregiverId();
    const targetPatientId = this.getPatientId(userId);
    if (!cgId || !targetPatientId) throw new Error('User not authenticated');

    const q = query(
      collection(this.firestore, 'caregiver', cgId, 'patients', targetPatientId, 'userProgress', 'stats', 'gameSessions'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as GameSession);
  }

  
  subscribeToGameSessions(onChange: (sessions: GameSession[]) => void): Unsubscribe {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');
    const colRef = collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats', 'gameSessions');
    const qy = query(colRef, orderBy('timestamp', 'desc'), limit(500));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map(d => d.data() as GameSession);
      onChange(list);
    });
  }

  
  async updateFlashcard(cardId: string, updates: Partial<Record<string, any>>): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    await updateDoc(doc(this.firestore, 'caregiver', user.uid, 'flashcards', cardId), this.sanitizeForFirestore(updates));
  }

  
  async updateStructuredFlashcard(cardId: string, category: string, updates: Partial<Record<string, any>>, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    const sanitized = this.sanitizeForFirestore(updates);
    await updateDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', category, 'cards', cardId), sanitized);

    
    try { window.dispatchEvent(new CustomEvent('flashcard-updated', { detail: { cardId, category, updates } })); } catch {}
  }

  
  async deleteFlashcard(cardId: string, category?: string, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    
    if (category) {
      try {
        await deleteDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', category, 'cards', cardId));
        
        try { window.dispatchEvent(new CustomEvent('flashcard-deleted', { detail: { cardId, category } })); } catch {}
        return;
      } catch (e) {
        console.warn('Failed to delete from structured path:', e);
      }
    }

    
    const batch = writeBatch(this.firestore);

    
    batch.delete(doc(this.firestore, 'caregiver', cgId, 'flashcards', cardId));

    
    const actsQ = query(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities'), where('cardId', '==', cardId));
    const actsSnap = await getDocs(actsQ);
    for (const a of actsSnap.docs) {
      
      const progSnap = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities', a.id, 'progress'));
      progSnap.docs.forEach(p => batch.delete(p.ref));
      
      batch.delete(a.ref);
    }

    await batch.commit();

    
    try { window.dispatchEvent(new CustomEvent('flashcard-deleted', { detail: { cardId } })); } catch {}
  }

  async deleteFlashcardsByCategory(categoryName: string, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    try {
      
      const cardsRef = collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', categoryName, 'cards');
      const cardsSnapshot = await getDocs(cardsRef);
      
      
      const batch = writeBatch(this.firestore);
      cardsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      
      try { 
        window.dispatchEvent(new CustomEvent('category-deleted', { detail: { categoryName } })); 
      } catch {}
    } catch (error) {
      console.error('Failed to delete flashcards by category:', error);
      throw error;
    }
  }

  async saveUserProgress(progressData: Partial<UserProgress>): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const updatedProgress = {
      ...progressData,
      lastUpdated: new Date().toISOString()
    };

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');
    await setDoc(
      doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats'),
      updatedProgress,
      { merge: true }
    );
  }

  async getUserProgress(userId?: string): Promise<UserProgress | null> {
    const cgId = this.getCaregiverId();
    const targetPatientId = this.getPatientId(userId);
    if (!cgId || !targetPatientId) throw new Error('User not authenticated');

    const docRef = doc(this.firestore, 'caregiver', cgId, 'patients', targetPatientId, 'userProgress', 'stats');
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() as UserProgress : null;
  }

  // ─── Media (video memories) ─────────────────────────────────────────────────
  // Upload/delete video memories (Cloudinary + optional Firebase Storage) and store metadata under patient.
  
  
  
  async uploadVideoToCloudinary(file: File, title?: string): Promise<{
    id: string;
    cloudinaryPublicId: string;
    videoUrl: string;
    thumbnailUrl: string;
    duration?: number;
    createdAt: number;
    title?: string;
  }> {
    const user = this.getCurrentUser();
    
    if (!user) {
      console.error(' uploadVideoToCloudinary - User not authenticated');
      throw new Error('User not authenticated');
    }

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required; video is only stored under patient.');

    try {
      const cloudinaryResult = await this.cloudinaryService.uploadVideo(file, {
        title: title || file.name || 'Untitled Video',
        folder: `alala/caregiver/${cgId}/patients/${pid}/videos`,
        userId: `${cgId}_${pid}`,
        description: `Video uploaded for patient ${pid}`
      });
      
      const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      
      const metadata = {
        id,
        caregiverId: cgId,
        patientId: pid,
        cloudinaryPublicId: cloudinaryResult.publicId,
        videoUrl: cloudinaryResult.secureUrl,
        thumbnailUrl: cloudinaryResult.secureUrl, 
        title: title || file.name || 'Untitled Video',
        duration: cloudinaryResult.duration,
        createdAt: Date.now(),
        width: cloudinaryResult.width,
        height: cloudinaryResult.height
      };
      await runInInjectionContext(this.injector, async () => {
        const patientVideoRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', id);
        await setDoc(patientVideoRef, this.sanitizeForFirestore(metadata), { merge: true });
      });
      
      return {
        id,
        cloudinaryPublicId: cloudinaryResult.publicId,
        videoUrl: cloudinaryResult.secureUrl,
        thumbnailUrl: cloudinaryResult.secureUrl, 
        duration: cloudinaryResult.duration,
        createdAt: metadata.createdAt,
        title: metadata.title
      };
    } catch (error) {
      console.error(' uploadVideoToCloudinary - Upload failed:', error);
      throw error;
    }
  }

  
  async uploadVideoToCloudinaryFixed(file: File, title?: string): Promise<{
    id: string;
    cloudinaryPublicId: string;
    videoUrl: string;
    thumbnailUrl: string;
    duration?: number;
    createdAt: number;
    title?: string;
  }> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required; video is only stored under patient.');

    try {
      console.log(' uploadVideoToCloudinaryFixed - Caregiver:', cgId, 'Patient:', pid);
      console.log(' uploadVideoToCloudinaryFixed - Starting Cloudinary upload...');
      
      const cloudinaryResult = await this.cloudinaryService.uploadVideo(file, {
        title: title || file.name || 'Untitled Video',
        folder: `alala/caregiver/${cgId}/patients/${pid}/videos`,
        userId: `${cgId}_${pid}`,
        description: `Video uploaded for patient ${pid}`
      });
      
      console.log(' uploadVideoToCloudinaryFixed - Cloudinary upload successful:', cloudinaryResult);
      
      const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      
      const metadata = {
        id,
        caregiverId: cgId,
        patientId: pid,
        cloudinaryPublicId: cloudinaryResult.publicId,
        videoUrl: cloudinaryResult.secureUrl,
        thumbnailUrl: cloudinaryResult.secureUrl, 
        title: title || file.name || 'Untitled Video',
        duration: cloudinaryResult.duration,
        createdAt: Date.now(),
        width: cloudinaryResult.width,
        height: cloudinaryResult.height
      };
      
      console.log(' uploadVideoToCloudinaryFixed - Saving metadata to Firestore subcollection:', metadata);

      try {
        await runInInjectionContext(this.injector, async () => {
          const sanitizedData = this.sanitizeForFirestore(metadata);
          const patientVideoRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', id);
          await setDoc(patientVideoRef, sanitizedData, { merge: true });
          console.log(' Video metadata saved under patient videos collection');
        });

        console.log(' uploadVideoToCloudinaryFixed - Upload complete');
      } catch (firestoreError) {
        console.error(' Firestore save failed:', firestoreError);
        throw new Error(`Failed to save video metadata to Firebase: ${firestoreError}`);
      }
      return {
        id,
        cloudinaryPublicId: cloudinaryResult.publicId,
        videoUrl: cloudinaryResult.secureUrl,
        thumbnailUrl: cloudinaryResult.secureUrl,
        duration: cloudinaryResult.duration,
        createdAt: metadata.createdAt,
        title: metadata.title
      };
    } catch (error) {
      console.error(' uploadVideoToCloudinaryFixed - Upload failed:', error);
      throw error;
    }
  }

  
  private async generateThumbnailFromVideo(videoUrl: string, fileName: string): Promise<string> {
    try {
      
      const cloudName = 'doypcw87t';
      const thumbnailUrl = `https://res.cloudinary.com/${cloudName}/image/fetch/w_300,h_auto,c_scale,f_jpg,q_auto/${encodeURIComponent(videoUrl)}`;
      
      
      const response = await fetch(thumbnailUrl, { method: 'HEAD' });
      if (response.ok) {
        return thumbnailUrl;
      } else {
        throw new Error('Thumbnail generation failed');
      }
    } catch (error) {
      console.warn('️ Cloudinary thumbnail generation failed:', error);
      throw error;
    }
  }

  
  async deleteVideoFromFirebaseStorage(videoId: string): Promise<boolean> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required.');

    try {
      console.log('️ deleteVideoFromFirebaseStorage - Deleting video:', videoId);
      const docRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.warn('️ Video document not found in patient videos');
        return false;
      }
      const metadata = docSnap.data() as any;
      if (metadata.storagePath) {
        try {
          console.log('️ Deleting from Firebase Storage:', metadata.storagePath);
          const storageRef = ref(this.storage, metadata.storagePath);
          await deleteObject(storageRef);
          console.log(' Firebase Storage file deleted successfully');
        } catch (storageError) {
          console.warn('️ Firebase Storage deletion failed:', storageError);
        }
      }
      await deleteDoc(docRef);
      console.log(' Hybrid deletion complete');
      return true;
    } catch (error) {
      console.error(' deleteVideoFromFirebaseStorage - Deletion failed:', error);
      return false;
    }
  }

  
  /** Deletes the video document from the current patient's videos subcollection (caregiver/.../patients/.../videos/{videoId}). */
  async deleteVideoFromCloudinary(videoId: string): Promise<boolean> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required.');

    try {
      console.log('️ deleteVideoFromCloudinary - Deleting video from patient videos:', videoId);
      const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
      const docSnap = await getDoc(videoDocRef);
      if (!docSnap.exists()) {
        console.warn('️ Video document not found in patient videos');
        return false;
      }
      const metadata = docSnap.data() as any;
      let cloudinaryDeleted = false;
      if (metadata.cloudinaryPublicId) {
        console.log('️ Attempting to delete from Cloudinary:', metadata.cloudinaryPublicId);
        try {
          cloudinaryDeleted = await this.cloudinaryService.deleteVideo(metadata.cloudinaryPublicId);
          console.log('️ Cloudinary deletion result:', cloudinaryDeleted);
        } catch (cloudinaryError) {
          console.warn('️ Cloudinary deletion failed with error:', cloudinaryError);
        }
      }
      console.log('️ Deleting from patient videos:', videoId);
      await deleteDoc(videoDocRef);
      
      
      if (!cloudinaryDeleted && metadata.cloudinaryPublicId) {
        console.warn('️ Video removed from app but may still exist in Cloudinary');
        console.log(' Due to browser limitations, Cloudinary deletion requires proper CORS configuration');
        console.log(' To completely remove from Cloudinary, use the Cloudinary dashboard');
        console.log(' The video is no longer visible in your app');
      }
      
      return true;
    } catch (error) {
      console.error(' deleteVideoFromCloudinary - Deletion failed:', error);
      return false;
    }
  }

  
  async updateVideoMetadata(videoId: string, updates: { title?: string; description?: string }): Promise<boolean> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required.');

    try {
      const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
      const docSnap = await getDoc(videoDocRef);
      
      if (!docSnap.exists()) {
        console.warn('️ Video document not found in subcollection');
        return false;
      }
      
      const currentMetadata = docSnap.data() as any;
      console.log(' Current video metadata:', currentMetadata);
      
      
      let cloudinaryUpdated = false;
      if (currentMetadata.cloudinaryPublicId && (updates.title || updates.description)) {
        console.log(' Attempting to update Cloudinary metadata...');
        try {
          cloudinaryUpdated = await this.cloudinaryService.updateVideoMetadata(currentMetadata.cloudinaryPublicId, {
            title: updates.title,
            description: updates.description
          });
          console.log(' Cloudinary metadata update result:', cloudinaryUpdated);
        } catch (error) {
          console.warn('️ Cloudinary metadata update failed:', error);
          console.log(' Continuing with Firestore update only');
        }
      }
      
      
      await updateDoc(videoDocRef, {
        ...this.sanitizeForFirestore(updates),
        updatedAt: Date.now()
      });
      
      console.log(' updateVideoMetadata - Update complete');
      return true;
    } catch (error) {
      console.error(' updateVideoMetadata - Update failed:', error);
      return false;
    }
  }

  
  async getCloudinaryVideos(): Promise<any[]> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    try {
      console.log(' Getting videos from Cloudinary for caregiver:', cgId, 'patient:', pid);
      
      const videos = await this.cloudinaryService.getUserVideos(`${cgId}_${pid}`);
      
      console.log(' Retrieved videos from Cloudinary:', videos.length);
      return videos;
    } catch (error) {
      console.error(' Failed to get videos from Cloudinary:', error);
      return [];
    }
  }

  
  subscribeToCloudinaryVideos(onChange: (videos: any[]) => void): () => void {
    const user = this.getCurrentUser();
    
    if (!user) {
      console.warn('️ subscribeToCloudinaryVideos - User not authenticated');
      onChange([]);
      return () => {}; 
    }

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    console.log(' subscribeToCloudinaryVideos - Setting up Firestore subscription for caregiver:', cgId, 'patient:', pid);
    
    return this.subscribeToVideos(onChange);
  }

  
  async syncVideosWithCloudinary(): Promise<{
    added: number;
    updated: number;
    deleted: number;
  }> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required for video sync.');

    try {
      const firestoreVideos = await this.debugGetVideos();
      let syncResult: { toAdd: any[]; toUpdate: any[]; toDelete: any[]; };
      try {
        syncResult = await this.cloudinaryService.syncVideosWithFirestore(`${cgId}_${pid}`, firestoreVideos);
      } catch (error) {
        console.warn('️ Cloudinary sync failed, operating in Firestore-only mode:', error);
        syncResult = { toAdd: [], toUpdate: [], toDelete: [] };
      }
      
      let added = 0;
      let updated = 0;
      let deleted = 0;
      
      for (const videoToAdd of syncResult.toAdd) {
        try {
          const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          const metadata = {
            id,
            caregiverId: cgId,
            patientId: pid,
            cloudinaryPublicId: videoToAdd.cloudinaryPublicId,
            videoUrl: videoToAdd.videoUrl,
            thumbnailUrl: videoToAdd.thumbnailUrl,
            title: videoToAdd.title,
            duration: videoToAdd.duration,
            width: videoToAdd.width,
            height: videoToAdd.height,
            createdAt: videoToAdd.createdAt
          };
          await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', id), this.sanitizeForFirestore(metadata));
          added++;
        } catch (error) {
          console.error(' Failed to add video to Firestore:', error);
        }
      }
      
      for (const videoToUpdate of syncResult.toUpdate) {
        try {
          await updateDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoToUpdate.id), {
            title: videoToUpdate.title
          });
          updated++;
        } catch (error) {
          console.error(' Failed to update video in Firestore:', error);
        }
      }
      
      for (const videoToDelete of syncResult.toDelete) {
        try {
          await deleteDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoToDelete.id));
          deleted++;
        } catch (error) {
          console.error(' Failed to delete video from Firestore:', error);
        }
      }
      
      console.log(' Synchronization complete:', { added, updated, deleted });
      return { added, updated, deleted };
    } catch (error) {
      console.error(' Failed to sync videos:', error);
      return { added: 0, updated: 0, deleted: 0 };
    }
  }

  
  async forceSyncVideos(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) return;

    try {
      console.log(' Force syncing videos...');
      const result = await this.syncVideosWithCloudinary();
      
      if (result.added > 0 || result.updated > 0 || result.deleted > 0) {
        console.log(' Sync completed with changes:', result);
        
        window.dispatchEvent(new CustomEvent('videos-synced', { detail: result }));
      } else {
        console.log(' Sync completed - no changes needed');
      }
    } catch (error) {
      console.error(' Force sync failed:', error);
    }
  }

  
  
  async uploadUserVideo(file: Blob, label?: string): Promise<{ id: string; downloadURL: string; createdAt: number; storagePath: string; label?: string; }> {
    const user = this.getCurrentUser();
    console.log(' uploadUserVideo - Current user:', user?.uid || 'NO USER');
    
    if (!user) {
      console.error(' uploadUserVideo - User not authenticated');
      throw new Error('User not authenticated');
    }

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    console.log(' uploadUserVideo - Starting upload for caregiver:', cgId, 'patient:', pid);
    console.log(' uploadUserVideo - File info:', { 
      size: file.size, 
      type: file.type, 
      label: label 
    });

    const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const path = `videos/${id}.mp4`;
    const storageRef = ref(this.storage, `caregiver/${cgId}/patients/${pid}/${path}`);
    
    console.log(' uploadUserVideo - Storage path:', `caregiver/${cgId}/patients/${pid}/${path}`);
    
    try {
      console.log(' uploadUserVideo - Uploading to Firebase Storage...');
      const snapshot = await uploadBytes(storageRef, file);
      console.log(' uploadUserVideo - Upload successful, getting download URL...');
      
      const url = await getDownloadURL(snapshot.ref);
      console.log(' uploadUserVideo - Download URL obtained:', url);

      const meta = { 
        id, 
        caregiverId: cgId,
        patientId: pid, 
        storagePath: path, 
        downloadURL: url, 
        label: label || null, 
        createdAt: Date.now() 
      } as any;
      
      console.log(' uploadUserVideo - Saving metadata to Firestore:', meta);
      await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', id), this.sanitizeForFirestore(meta));
      console.log(' uploadUserVideo - Metadata saved successfully');
      
      const result = { id, downloadURL: url, createdAt: meta.createdAt, storagePath: path, label };
      console.log(' uploadUserVideo - Upload complete:', result);
      return result;
    } catch (error) {
      console.error(' uploadUserVideo - Upload failed:', error);
      throw error;
    }
  }

  
  async universalDeleteVideo(videoId: string): Promise<boolean> {
    const user = this.getCurrentUser();
    if (!user) return false;

    try {
      console.log('️ WEBHOOK-ENHANCED universal deletion triggered for video:', videoId);
      
      
      const firebaseVideos = await this.debugGetVideos();
      const videoToDelete = firebaseVideos.find(video => video.id === videoId);
      
      if (!videoToDelete) {
        console.log('️ Video not found in Firebase:', videoId);
        return false;
      }
      
      console.log('️ Video found, proceeding with WEBHOOK-ENHANCED universal deletion:', videoToDelete.label);
      
      
      console.log('️ Deleting from Firebase first for immediate UI update:', videoId);
      const firebaseDeleted = await this.deleteVideoFromFirebase(videoId);
      console.log('️ Firebase deletion result:', firebaseDeleted);
      
      
      console.log('️ Triggering immediate UI update for deleted video');
      try {
        window.dispatchEvent(new CustomEvent('video-deleted-universal', { 
          detail: { videoId, cloudinaryDeleted: false, firebaseDeleted } 
        }));
      } catch (e) {
        console.warn('️ Could not dispatch universal deletion event:', e);
      }
      
      
      let cloudinaryDeleted = false;
      if (videoToDelete.cloudinaryPublicId) {
        try {
          console.log('️ Attempting Cloudinary deletion (will fallback to Firestore trigger if CORS fails):', videoToDelete.cloudinaryPublicId);
          cloudinaryDeleted = await this.cloudinaryService.deleteVideo(videoToDelete.cloudinaryPublicId);
          console.log('️ Cloudinary deletion result:', cloudinaryDeleted);
          
          if (!cloudinaryDeleted) {
            console.log(' Cloudinary deletion failed due to CORS - Firestore trigger will handle it automatically');
          }
          
          
          try {
            window.dispatchEvent(new CustomEvent('video-deleted-universal', { 
              detail: { videoId, cloudinaryDeleted, firebaseDeleted } 
            }));
          } catch (e) {
            console.warn('️ Could not dispatch updated deletion event:', e);
          }
        } catch (error) {
          console.log(' Cloudinary deletion failed due to CORS - Firestore trigger will handle it automatically:', error);
        }
      }
      
      const success = firebaseDeleted; 
      console.log(` WEBHOOK-ENHANCED universal deletion complete: ${success ? 'SUCCESS' : 'FAILED'}`);
      return success;
      
    } catch (error) {
      console.error(' WEBHOOK-ENHANCED universal deletion failed:', error);
      return false;
    }
  }

  
  /** Deletes the video doc from the current patient's videos subcollection (caregiver/.../patients/.../videos/{videoId}). */
  private async deleteVideoFromFirebase(videoId: string): Promise<boolean> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) return false;

    try {
      console.log('️ deleteVideoFromFirebase - Deleting from patient videos:', videoId);
      const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
      const docSnap = await getDoc(videoDocRef);
      if (!docSnap.exists()) {
        console.log('️ Video document not found in Firebase:', videoId);
        return false;
      }
      await deleteDoc(videoDocRef);
      console.log(' Video deleted from patient videos collection:', videoId);
      return true;
    } catch (error) {
      console.error(' Failed to delete video from Firebase:', error);
      return false;
    }
  }

  
  async detectAndSyncCloudinaryDeletions(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) return;

    try {
      console.log(' ULTRA AGGRESSIVE Cloudinary deletion detection...');
      
      
      const firebaseVideos = await this.debugGetVideos();
      console.log(' Firebase videos to check:', firebaseVideos.length);
      
      if (firebaseVideos.length === 0) {
        console.log(' No Firebase videos to check');
        return;
      }
      
      const videosToDelete: any[] = [];
      
      
      for (const firebaseVideo of firebaseVideos) {
        if (!firebaseVideo.downloadURL && !firebaseVideo.videoURL) {
          console.log('️ Video has no URL, skipping:', firebaseVideo.id);
          continue;
        }
        
        const videoUrl = firebaseVideo.downloadURL || firebaseVideo.videoURL;
        
        try {
          
          const response = await fetch(videoUrl, { method: 'HEAD' });
          if (!response.ok) {
            console.log('️ Video not found (404/403), marking for ULTRA AGGRESSIVE deletion:', firebaseVideo.id);
            videosToDelete.push(firebaseVideo);
          } else {
            
            if (Math.random() < 0.001) {
              console.log(' Video still exists:', firebaseVideo.id);
            }
          }
        } catch (error) {
          console.log('️ Error checking video URL, assuming it exists:', firebaseVideo.id);
        }
      }
      
      if (videosToDelete.length === 0) {
        
        if (Math.random() < 0.001) {
          console.log(' No videos need ULTRA AGGRESSIVE deletion');
        }
        return;
      }
      
      console.log(' Videos to delete from all platforms (ULTRA AGGRESSIVE):', videosToDelete.length);
      
      
      for (const videoToDelete of videosToDelete) {
        console.log('️ Triggering ULTRA AGGRESSIVE universal deletion for:', videoToDelete.id);
        await this.universalDeleteVideo(videoToDelete.id);
        
        
      }
      
      console.log(` ULTRA AGGRESSIVE universal deletion triggered for ${videosToDelete.length} videos`);
      
      
      try {
        window.dispatchEvent(new CustomEvent('ultra-aggressive-ui-refresh', { 
          detail: { deletedCount: videosToDelete.length, deletedIds: videosToDelete.map(v => v.id) } 
        }));
      } catch (e) {
        console.warn('️ Could not dispatch ultra-aggressive UI refresh event:', e);
      }
      
    } catch (error) {
      console.error(' Failed to detect Cloudinary deletions (ULTRA AGGRESSIVE):', error);
    }
  }

  
  async syncDeletionsFromCloudinary(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) return;

    try {
      console.log(' Starting deletion sync from Cloudinary...');
      
      
      const firebaseVideos = await this.debugGetVideos();
      console.log(' Firebase videos:', firebaseVideos.length);
      
      if (firebaseVideos.length === 0) {
        console.log(' No Firebase videos to sync');
        return;
      }
      
      
      const cgId = this.getCaregiverId();
      const pid = this.getPatientId();
      const cloudinaryVideos = await this.cloudinaryService.getUserVideos(`${cgId}_${pid}`);
      console.log(' Cloudinary videos:', cloudinaryVideos.length);
      
      
      const cloudinaryPublicIds = new Set(cloudinaryVideos.map(video => video.cloudinaryPublicId));
      
      
      const videosToDelete = firebaseVideos.filter(firebaseVideo => {
        if (!firebaseVideo.cloudinaryPublicId) return false;
        return !cloudinaryPublicIds.has(firebaseVideo.cloudinaryPublicId);
      });
      
      console.log(' Videos to delete from Firebase:', videosToDelete.length);
      
      if (videosToDelete.length === 0) {
        console.log(' No videos need deletion sync');
        return;
      }
      
      if (!cgId || !pid) {
        console.warn(' No caregiver/patient context for deletion sync');
        return;
      }
      for (const video of videosToDelete) {
        try {
          const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', video.id);
          await deleteDoc(videoDocRef);
        } catch (e) {
          console.warn(' Failed to delete video from patient collection:', video.id, e);
        }
      }
      console.log(` Synced ${videosToDelete.length} deletions from Cloudinary to patient videos`);
      
      
      videosToDelete.forEach(video => {
        console.log(`️ Deleted from Firebase: ${video.id} (${video.label})`);
      });
      
      
      try {
        const deletedIds = videosToDelete.map(v => v.id);
        window.dispatchEvent(new CustomEvent('videos-synced', { detail: { added: 0, updated: 0, deleted: deletedIds.length, deletedIds } }));
      } catch (e) {
        
      }
      
    } catch (error) {
      console.error(' Failed to sync deletions from Cloudinary:', error);
    }
  }

  
  async migrateVideoUrls(): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) return;

    try {
      console.log(' Starting video URL migration (patient videos only)...');
      const patientVideosRef = collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos');
      const snapshot = await getDocs(patientVideosRef);
      if (snapshot.empty) return;

      const batch = writeBatch(this.firestore);
      let updateCount = 0;
      snapshot.docs.forEach((docSnap) => {
        const videoData = docSnap.data() as any;
        const hasOldThumbnail = videoData['thumbnailUrl'] && (
          videoData['thumbnailUrl'].includes('/image/upload/format_jpg/') ||
          videoData['thumbnailUrl'].includes('/video/upload/v')
        );
        const hasOldVideoUrl = videoData['videoUrl'] && videoData['videoUrl'].includes('/video/upload/v');
        if (hasOldThumbnail || hasOldVideoUrl) {
          const publicId = videoData['cloudinaryPublicId'];
          const correctVideoUrl = publicId
            ? `https://res.cloudinary.com/doypcw87t/video/upload/${publicId}.mp4`
            : (videoData['videoUrl'] || videoData['downloadURL'] || videoData['videoURL'] || '');
          const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', docSnap.id);
          batch.update(videoDocRef, { thumbnailUrl: correctVideoUrl, videoUrl: correctVideoUrl });
          updateCount++;
        }
      });
      if (updateCount > 0) {
        await batch.commit();
        console.log(` Migrated ${updateCount} videos to use correct URLs`);
      }
    } catch (error) {
      console.error(' Migration failed:', error);
    }
  }

  
  subscribeToVideos(onChange: (videos: Array<{ id: string; downloadURL: string; label?: string; createdAt: number }>) => void): Unsubscribe {
    const user = this.getCurrentUser();
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    console.log(' subscribeToVideos - Current user:', user?.uid || 'NO USER', 'cgId:', cgId, 'pid:', pid);

    if (!user || !cgId || !pid) {
      console.warn('️ subscribeToVideos - Missing auth / caregiver / patient, returning empty subscription');

      setTimeout(() => {
        console.log(' subscribeToVideos - Calling onChange with empty array (no user/patient)');
        onChange([]);
      }, 0);

      return () => {
        console.log(' subscribeToVideos - Dummy unsubscribe called');
      };
    }

    console.log(' subscribeToVideos - Setting up patient videos subscription for caregiver/patient:', cgId, pid);

    return runInInjectionContext(this.injector, () => {
      const patientVideosCollectionRef = collection(
        this.firestore,
        'caregiver', cgId,
        'patients', pid,
        'videos'
      );

      const videoQuery = query(
        patientVideosCollectionRef,
        orderBy('createdAt', 'desc')
      );

      return onSnapshot(videoQuery, (querySnapshot) => {
        console.log(' subscribeToVideos - Query snapshot received:', querySnapshot.size, 'videos');

        const videos: any[] = [];

        querySnapshot.forEach((docSnap) => {
          const videoData = docSnap.data();
          console.log(' subscribeToVideos - Video document:', docSnap.id, videoData);

          videos.push({
            id: docSnap.id,
            downloadURL: videoData['videoUrl'] || videoData['videoURL'],
            label: videoData['title'] || undefined,
            createdAt: videoData['createdAt'],
            thumbnailUrl: videoData['thumbnailUrl'],
            duration: videoData['duration'],
            cloudinaryPublicId: videoData['cloudinaryPublicId'],
            width: videoData['width'],
            height: videoData['height']
          });
        });

        console.log(' subscribeToVideos - Processed videos:', videos.length);
        onChange(videos);
      }, (error) => {
        console.error(' subscribeToVideos - Firebase error:', error);
        onChange([]);
      });
    });
  }

  
  /** No-op: video add/delete use only patient videos collection; no migration from users collection. */
  async forceMigrateVideosToSubcollection(): Promise<void> {
    console.log(' forceMigrateVideosToSubcollection - Skipped (only patient videos collection is used)');
  }
  /** No-op: video add/delete use only patient videos collection; no migration from users collection. */
  async migrateVideosToSubcollection(): Promise<void> {
    console.log(' migrateVideosToSubcollection - Skipped (only patient videos collection is used)');
  }

  
  async verifyVideoSaved(videoId: string): Promise<boolean> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) return false;

    try {
      const videoDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
      const docSnap = await getDoc(videoDocRef);
      return docSnap.exists();
    } catch (error) {
      console.error(' Error verifying video saved:', error);
      return false;
    }
  }

  async debugGetVideos(): Promise<any[]> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) {
      console.log(' debugGetVideos - No caregiver/patient context');
      return [];
    }

    try {
      const patientVideosRef = collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos');
      const videoQuery = query(patientVideosRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(videoQuery);
      const processedVideos: any[] = [];
      querySnapshot.forEach((docSnap) => {
        const videoData = docSnap.data();
        processedVideos.push({
          id: docSnap.id,
          downloadURL: videoData['videoUrl'] || videoData['videoURL'],
          label: videoData['title'] || undefined,
          createdAt: videoData['createdAt'],
          thumbnailUrl: videoData['thumbnailUrl'],
          duration: videoData['duration'],
          cloudinaryPublicId: videoData['cloudinaryPublicId'],
          width: videoData['width'],
          height: videoData['height']
        });
      });
      return processedVideos;
    } catch (error) {
      console.error(' debugGetVideos - Error:', error);
      return [];
    }
  }

  
  async deleteUserVideo(videoId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');
    const docRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos', videoId);
    const metaSnap = await getDoc(docRef);
    const meta: any = metaSnap.exists() ? metaSnap.data() : null;
    
    
    if (meta?.storagePath) {
      try { 
        await deleteObject(ref(this.storage, `caregiver/${cgId}/patients/${pid}/${meta.storagePath}`)); 
        console.log(' Video file deleted from Firebase Storage');
      } catch (error) {
        console.warn('️ Failed to delete video file from Storage:', error);
      }
    }
    
    
    await deleteDoc(docRef);
    console.log(' Video metadata deleted from Firestore');
  }

  
  
  async saveVideoMemory(input: { id?: string; title: string; videoURL: string; poster?: string | null }): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const title = (input.title || '').toString().trim();
    const videoURL = (input.videoURL || '').toString().trim();
    if (!title || !videoURL) throw new Error('Title and video URL are required');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('User not authenticated');
    const colRef = collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'videoMemories', 'cards');

    
    const [byTitleSnap, byUrlSnap] = await runInInjectionContext(this.injector, async () => {
      return await Promise.all([
        getDocs(query(colRef, where('titleLower', '==', title.toLowerCase()))),
        getDocs(query(colRef, where('videoURL', '==', videoURL)))
      ]);
    });

    if (!byTitleSnap.empty || !byUrlSnap.empty) {
      throw new Error('Duplicate video memory detected (same title or video URL)');
    }

    const id = input.id || `vm_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const data = this.sanitizeForFirestore({
      id,
      caregiverId: cgId,
      patientId: pid,
      title,
      titleLower: title.toLowerCase(),
      videoURL,
      poster: input.poster || null,
      createdAt: Date.now(),
      category: 'videoMemories'
    });
    await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'videoMemories', 'cards', id), data);
    return id;
  }

  
  subscribeToVideoMemories(onChange: (videos: Array<{ id: string; title: string; videoURL: string; poster?: string; createdAt: number }>) => void, patientId?: string): Unsubscribe {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');
    const qy = query(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'videoMemories', 'cards'), orderBy('createdAt', 'desc'));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map(d => d.data() as any).map(v => ({ id: v.id, title: v.title, videoURL: v.videoURL, poster: v.poster || undefined, createdAt: v.createdAt }));
      onChange(list);
    });
  }

  
  async updateVideoMemory(videoId: string, updates: { title?: string; poster?: string }, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');

    const docRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'videoMemories', 'cards', videoId);
    
    const updateData: any = {};
    if (updates.title) {
      updateData.title = updates.title;
      updateData.titleLower = updates.title.toLowerCase();
    }
    if (updates.poster !== undefined) {
      updateData.poster = updates.poster;
    }
    
    await updateDoc(docRef, this.sanitizeForFirestore(updateData));
  }

  
  async deleteVideoMemory(videoId: string, patientId?: string): Promise<void> {
    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('User not authenticated');
    const docRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', 'videoMemories', 'cards', videoId);
    await deleteDoc(docRef);
  }

  
  async findUserBySecurityCode(securityCode: string): Promise<{ uid: string; email?: string; name?: string } | null> {
    try {
      
      const hardcodedUsers: { [key: string]: { uid: string; email?: string; name?: string } } = {
        'NW9KA3JN': {
          uid: '98he1yB8w3aeAx8ILWe9eVT56m83',
          email: 'gian@gmail.com',
          name: 'Gian Bernandino'
        }
        
      };

      
      if (hardcodedUsers[securityCode]) {
        console.log(`Found hardcoded user for security code: ${securityCode}`);
        return hardcodedUsers[securityCode];
      }

      
      try {
        const securityCodesRef = collection(this.firestore, 'securityCodes');
        const qy = query(securityCodesRef, where('code', '==', securityCode));
        const snap = await getDocs(qy);
        
        if (!snap.empty) {
          const doc = snap.docs[0];
          const data = doc.data();
          return { 
            uid: data['userId'], 
            email: data['email'], 
            name: data['name'] 
          };
        }
      } catch (securityCodesError) {
        console.log('SecurityCodes collection not accessible, trying caregiver collection...');
      }
      
      
      const usersRef = collection(this.firestore, 'caregiver');
      const userQuery = query(usersRef, where('securityCode', '==', securityCode));
      const userSnap = await getDocs(userQuery);
      
      if (!userSnap.empty) {
        const d = userSnap.docs[0];
        const data: any = d.data();
        return { uid: d.id, email: data?.email, name: data?.name };
      }
      
      return null;
    } catch (error) {
      console.error('Security code lookup failed:', error);
      return null;
    }
  }

  
  /** No longer adds to securityCodes collection. */
  async createSecurityCodeEntry(_userId: string, _securityCode: string, _userData: { email?: string; name?: string }): Promise<void> {
    // Adding to securityCodes collection has been removed.
  }

  
  async setupSecurityCodeForExistingUser(userId: string, securityCode: string): Promise<void> {
    try {
      
      const userRef = doc(this.firestore, 'caregiver', userId);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        
        
        await this.createSecurityCodeEntry(userId, securityCode, {
          email: userData['email'] || '',
          name: userData['name'] || ''
        });
        
        console.log(` Security code entry created for user ${userId} with code ${securityCode}`);
      }
    } catch (error) {
      console.error('Failed to setup security code for existing user:', error);
    }
  }

  /** No longer adds or updates securityCodes collection. */
  async updateSecurityCodeEntry(_userId: string, _oldCode: string, _newCode: string, _userData: { email?: string; name?: string }): Promise<void> {
    // Adding/updating securityCodes collection has been removed.
  }

  
  async setCaregiverPassword(userId: string, password: string): Promise<void> {
    const userRef = doc(this.firestore, 'caregiver', userId);
    await updateDoc(userRef, { 
      caregiverPassword: password,
      caregiverPasswordSetAt: Date.now()
    });
  }

  async getCaregiverPassword(userId: string): Promise<string | null> {
    const userRef = doc(this.firestore, 'caregiver', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;
    const data = userSnap.data();
    return data?.['caregiverPassword'] || null;
  }

  async removeCaregiverPassword(userId: string): Promise<void> {
    const userRef = doc(this.firestore, 'caregiver', userId);
    await updateDoc(userRef, { 
      caregiverPassword: deleteField(),
      caregiverPasswordSetAt: deleteField()
    });
  }

  async verifyCaregiverPassword(userId: string, password: string): Promise<boolean> {
    const storedPassword = await this.getCaregiverPassword(userId);
    return storedPassword === password;
  }

  
  async updateUserData(userId: string, data: Partial<UserData>): Promise<void> {
    const userRef = doc(this.firestore, 'caregiver', userId);
    await updateDoc(userRef, data);
  }

  
  private async initializeUserProgress(patientId: string, caregiverId?: string): Promise<void> {
    // Use provided caregiverId or get current caregiver ID
    const cgId = caregiverId || this.getCaregiverId();
    if (!cgId) {
      console.warn('initializeUserProgress: No caregiver ID available');
      return;
    }
    
    // Ensure we're using the correct patient ID (not caregiver ID)
    const pid = patientId;
    if (!pid) {
      console.warn('initializeUserProgress: No patient ID provided');
      return;
    }
    
    const statsRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats');
    const existing = await getDoc(statsRef);
    if (existing.exists()) return;

    const zeroProgress: UserProgress = {
      overallStats: {
        accuracy: 0,
        avgTimePerCard: 0,
        totalCards: 0,
        skippedCards: 0
      },
      categoryStats: [
        { name: 'People',  icon: '', accuracy: 0, cardsPlayed: 0, avgTime: 0 },
        { name: 'Places',  icon: '', accuracy: 0, cardsPlayed: 0, avgTime: 0 },
        { name: 'Objects', icon: '', accuracy: 0, cardsPlayed: 0, avgTime: 0 },
        { name: 'Category Match', icon: '', accuracy: 0, cardsPlayed: 0, avgTime: 0 }
      ],
      categoryMatch: {
        sessions: {},
        totalSessions: 0,
        overallAccuracy: 0
      },
      lastCalculated: new Date().toISOString()
    };

    await setDoc(statsRef, this.sanitizeForFirestore(zeroProgress));
  }

  
  async ensureProgressInitialized(): Promise<void> {
    const user = this.getCurrentUser();
    const storedUserId = localStorage.getItem('userId');
    
    
    const userId = user?.uid || storedUserId;
    
    if (!userId) throw new Error('User not authenticated');
    await this.initializeUserProgress(userId);
  }

  
  async updateUserStats(stats: {
    overallStats: any;
    categoryStats?: any[];
    recentSessions?: any[];
    accuracyOverTime: {
      today: number;
      week: number;
      month: number;
      allTime: number;
    };
  }): Promise<void> {
    try {
      console.log(' Firebase updateUserStats called with:', stats);
      
      const user = this.getCurrentUser();
      if (!user) {
        console.error(' User not authenticated');
        throw new Error('User not authenticated');
      }

      console.log(' User authenticated:', user.uid);

      const cgId = this.getCaregiverId();
      const pid = this.getPatientId();
      if (!cgId || !pid) throw new Error('User not authenticated');
      const statsRef = doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats');
      
      const updatedStats: UserProgress = {
        overallStats: stats.overallStats,
        categoryStats: stats.categoryStats || [],
        categoryMatch: {
          sessions: {},
          totalSessions: 0,
          overallAccuracy: 0
        },
        lastCalculated: new Date().toISOString(),
        
        accuracyOverTime: stats.accuracyOverTime,
        recentSessions: stats.recentSessions?.slice(0, 10) || [], 
        totalSessions: stats.recentSessions?.length || 0
      };

      console.log(' Prepared stats document:', updatedStats);

      const sanitizedStats = this.sanitizeForFirestore(updatedStats);
      console.log(' Sanitized stats document:', sanitizedStats);

      await setDoc(statsRef, sanitizedStats);
      console.log(' Updated user stats in Firebase successfully');
    } catch (error) {
      console.error(' Failed to update user stats:', error);
      throw error;
    }
  }

  
  getCachedData<T>(key: string, fallback: T): T {
    try {
      const uid = this.getCurrentUser()?.uid || localStorage.getItem('userId') || 'anon';
      const cachedKey = `${key}_${uid}`;
      const cached = localStorage.getItem(cachedKey);
      return cached ? JSON.parse(cached) : fallback;
    } catch (e) {
      console.warn(`Failed to get cached data for ${key}:`, e);
      return fallback;
    }
  }

  
  cacheData<T>(key: string, data: T): void {
    try {
      const uid = this.getCurrentUser()?.uid || localStorage.getItem('userId') || 'anon';
      const cacheKey = `${key}_${uid}`;
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      console.warn(`Failed to cache data for ${key}:`, e);
    }
  }

  // ─── Category Match ─────────────────────────────────────────────────────────
  // Save/read/delete Category Match sessions and compute the aggregate Category Match progress block.
  

  
  async saveCategoryMatchSession(correct: number, total: number): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    if (total <= 0) throw new Error('Total answers must be greater than 0');
    if (correct < 0 || correct > total) throw new Error('Correct answers must be between 0 and total');

    const accuracy = total > 0 ? correct / total : 0;
    const sessionId = `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const session: CategoryMatchSession = {
      id: sessionId,
      timestamp: new Date().toISOString(),
      correct,
      total,
      accuracy
    };

    
    const currentProgress = await this.getUserProgress();
    if (!currentProgress) throw new Error('User progress not found');

    
    const updatedSessions = {
      ...currentProgress.categoryMatch.sessions,
      [sessionId]: session
    };

    
    const allSessions = Object.values(updatedSessions);
    const totalCorrect = allSessions.reduce((sum, s) => sum + s.correct, 0);
    const totalAnswers = allSessions.reduce((sum, s) => sum + s.total, 0);
    const overallAccuracy = totalAnswers > 0 ? totalCorrect / totalAnswers : 0;

    
    const updatedProgress: Partial<UserProgress> = {
      categoryMatch: {
        sessions: updatedSessions,
        totalSessions: allSessions.length,
        overallAccuracy
      },
      lastCalculated: new Date().toISOString()
    };

    await this.saveUserProgress(updatedProgress);
    return sessionId;
  }

  
  async getCategoryMatchSessions(userId?: string): Promise<CategoryMatchSession[]> {
    const user = this.getCurrentUser();
    const targetUserId = userId || user?.uid;

    if (!targetUserId) throw new Error('User not authenticated');

    const progress = await this.getUserProgress(targetUserId);
    if (!progress || !progress.categoryMatch) return [];

    return Object.values(progress.categoryMatch.sessions).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  
  async getCategoryMatchProgress(userId?: string): Promise<{
    totalSessions: number;
    overallAccuracy: number;
    recentSessions: CategoryMatchSession[];
  } | null> {
    const user = this.getCurrentUser();
    const targetUserId = userId || user?.uid;

    if (!targetUserId) throw new Error('User not authenticated');

    const progress = await this.getUserProgress(targetUserId);
    if (!progress || !progress.categoryMatch) return null;

    const sessions = Object.values(progress.categoryMatch.sessions).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return {
      totalSessions: progress.categoryMatch.totalSessions,
      overallAccuracy: progress.categoryMatch.overallAccuracy,
      recentSessions: sessions.slice(0, 10) 
    };
  }

  
  async deleteCategoryMatchSession(sessionId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const currentProgress = await this.getUserProgress();
    if (!currentProgress || !currentProgress.categoryMatch) throw new Error('User progress not found');

    
    const updatedSessions = { ...currentProgress.categoryMatch.sessions };
    delete updatedSessions[sessionId];

    
    const allSessions = Object.values(updatedSessions);
    const totalCorrect = allSessions.reduce((sum, s) => sum + s.correct, 0);
    const totalAnswers = allSessions.reduce((sum, s) => sum + s.total, 0);
    const overallAccuracy = totalAnswers > 0 ? totalCorrect / totalAnswers : 0;

    
    const updatedProgress: Partial<UserProgress> = {
      categoryMatch: {
        sessions: updatedSessions,
        totalSessions: allSessions.length,
        overallAccuracy
      },
      lastCalculated: new Date().toISOString()
    };

    await this.saveUserProgress(updatedProgress);
  }

  // ─── Custom categories & cards ──────────────────────────────────────────────
  // CRUD for user-defined categories and cards (separate from built-in People/Places/Objects buckets).
  

  
  async createUserCategory(categoryData: Omit<UserCategory, 'id' | 'userId' | 'createdAt'>): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const categoryId = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const category = {
      id: categoryId,
      caregiverId: cgId,
      patientId: pid,
      createdAt: Date.now(),
      ...categoryData
    };

    await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', categoryId), category);
    return categoryId;
  }

  
  async getUserCategories(patientId?: string): Promise<UserCategory[]> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const q = query(
      collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories'),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as UserCategory);
  }

  
  async updateUserCategory(categoryId: string, updates: Partial<Omit<UserCategory, 'id' | 'userId' | 'createdAt'>>): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const categoryDoc = await getDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', categoryId));
    if (!categoryDoc.exists()) {
      throw new Error('Category not found or access denied');
    }

    await updateDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', categoryId), updates);
  }

  
  async deleteUserCategory(categoryId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const categoryDoc = await getDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', categoryId));
    if (!categoryDoc.exists()) {
      throw new Error('Category not found or access denied');
    }

    const cardsQuery = query(
      collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards'),
      where('categoryId', '==', categoryId)
    );

    const cardsSnapshot = await getDocs(cardsQuery);
    const batch = writeBatch(this.firestore);

    cardsSnapshot.docs.forEach(d => {
      batch.delete(d.ref);
    });

    batch.delete(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', categoryId));

    await batch.commit();
  }

  

  
  async createUserCard(cardData: Omit<UserCard, 'id' | 'userId' | 'createdAt'>): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const categoryDoc = await getDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories', cardData.categoryId));
    if (!categoryDoc.exists()) {
      throw new Error('Category not found or access denied');
    }

    const cardId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const card = {
      id: cardId,
      caregiverId: cgId,
      patientId: pid,
      createdAt: Date.now(),
      ...cardData
    };

    await setDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards', cardId), card);
    return cardId;
  }

  
  async getUserCards(categoryId: string, patientId?: string): Promise<UserCard[]> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const q = query(
      collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards'),
      where('categoryId', '==', categoryId),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as UserCard);
  }

  
  async getAllUserCards(patientId?: string): Promise<UserCard[]> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId(patientId);
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const q = query(
      collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards'),
      orderBy('createdAt', 'desc'),
      limit(500) 
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as UserCard);
  }

  
  async updateUserCard(cardId: string, updates: Partial<Omit<UserCard, 'id' | 'userId' | 'createdAt'>>): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const cardDoc = await getDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards', cardId));
    if (!cardDoc.exists()) {
      throw new Error('Card not found or access denied');
    }

    await updateDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards', cardId), updates);
  }

  
  async deleteUserCard(cardId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const cardDoc = await getDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards', cardId));
    if (!cardDoc.exists()) {
      throw new Error('Card not found or access denied');
    }

    await deleteDoc(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards', cardId));
  }

  

  
  async uploadFile(file: Blob, path: string): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const storageRef = ref(this.storage, `caregiver/${cgId}/patients/${pid}/${path}`);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
  }

  
  async deleteFile(path: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const storageRef = ref(this.storage, `caregiver/${cgId}/patients/${pid}/${path}`);
    await deleteObject(storageRef);
  }

  

  
  async migrateLocalDataToFirebase(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    console.log(' Starting data migration to Firebase for caregiver:', cgId, 'patient:', pid);

    const userSpecificKey = `alala_custom_categories_v1_${pid}`;
    const localCategories = localStorage.getItem(userSpecificKey);
    if (localCategories) {
      const categories = JSON.parse(localCategories);
      for (const category of categories) {
        try {
          await this.createUserCategory({
            name: category.name,
            description: category.description,
            emoji: category.emoji
          });
          console.log(` Migrated category: ${category.name}`);
        } catch (error) {
          console.error(` Failed to migrate category ${category.name}:`, error);
        }
      }
    }

    const localSessions = localStorage.getItem(`gameSessions_${pid}`) || localStorage.getItem('gameSessions');
    if (localSessions) {
      const sessions = JSON.parse(localSessions);
      for (const session of sessions) {
        try {
          await this.saveGameSession(session);
          console.log(` Migrated game session from ${session.timestamp}`);
        } catch (error) {
          console.error(` Failed to migrate game session:`, error);
        }
      }
    }

    console.log(' Data migration completed');
  }

  
  async clearAllUserData(): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const cgId = this.getCaregiverId();
    const pid = this.getPatientId();
    if (!cgId || !pid) throw new Error('Caregiver/patient context required');

    const batch = writeBatch(this.firestore);

    const categoriesSnapshot = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCategories'));
    categoriesSnapshot.docs.forEach(d => batch.delete(d.ref));

    const cardsSnapshot = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userCards'));
    cardsSnapshot.docs.forEach(d => batch.delete(d.ref));
    
    const acts = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities'));
    for (const a of acts.docs) {
      const prog = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'activities', a.id, 'progress'));
      prog.docs.forEach(p => batch.delete(p.ref));
      batch.delete(a.ref);
    }

    
    const vids = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'videos'));
    vids.docs.forEach(v => batch.delete(v.ref));

    
    const buckets = ['people','places','objects','custom-category','photo-memories','videoMemories'];
    for (const b of buckets) {
      const cards = await getDocs(collection(this.firestore, 'caregiver', cgId, 'patients', pid, 'userFlashcards', b, 'cards'));
      cards.docs.forEach(c => batch.delete(c.ref));
    }

    
    batch.delete(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'userProgress', 'stats'));
    batch.delete(doc(this.firestore, 'caregiver', cgId, 'patients', pid, 'patientInfo', 'details'));

    await batch.commit();
  }

  

  
  // ─── Trusted contacts & patients ────────────────────────────────────────────
  // Trusted contact relationships plus caregiver-side patient CRUD and patient list subscriptions.
  async addTrustedContact(patientUserId: string, caregiverUserId: string, contactInfo: any): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    
    if (user.uid !== patientUserId && user.uid !== caregiverUserId) {
      throw new Error('Access denied');
    }

    const contactId = `${caregiverUserId}_${patientUserId}`;
    const trustedContact = {
      id: contactId,
      patientUserId,
      caregiverUserId,
      ...contactInfo,
      createdAt: new Date().toISOString(),
      createdBy: user.uid
    };

    await setDoc(doc(this.firestore, 'trustedContacts', contactId), trustedContact);
  }

  
  async getTrustedContacts(): Promise<any[]> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    
    const asPatientQuery = query(
      collection(this.firestore, 'trustedContacts'),
      where('patientUserId', '==', user.uid)
    );

    
    const asCaregiverQuery = query(
      collection(this.firestore, 'trustedContacts'),
      where('caregiverUserId', '==', user.uid)
    );

    const [patientSnapshot, caregiverSnapshot] = await Promise.all([
      getDocs(asPatientQuery),
      getDocs(asCaregiverQuery)
    ]);

    const contacts = [
      ...patientSnapshot.docs.map(doc => ({ ...doc.data(), role: 'patient' })),
      ...caregiverSnapshot.docs.map(doc => ({ ...doc.data(), role: 'caregiver' }))
    ];

    return contacts;
  }

  
  async removeTrustedContact(contactId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    
    const contactDoc = await getDoc(doc(this.firestore, 'trustedContacts', contactId));
    if (!contactDoc.exists()) {
      throw new Error('Contact relationship not found');
    }

    const contactData = contactDoc.data() as TrustedContact;
    if (contactData?.patientUserId !== user.uid && contactData?.caregiverUserId !== user.uid) {
      throw new Error('Access denied');
    }

    await deleteDoc(doc(this.firestore, 'trustedContacts', contactId));
  }

  
  async canAccessUserData(targetUserId: string): Promise<boolean> {
    const user = this.getCurrentUser();
    if (!user) return false;

    
    if (user.uid === targetUserId) return true;

    
    const contactId = `${user.uid}_${targetUserId}`;
    const contactDoc = await getDoc(doc(this.firestore, 'trustedContacts', contactId));

    return contactDoc.exists();
  }

  /** Get all patients for the current caregiver */
  async getPatients(): Promise<Array<{ id: string; name?: string; photo?: string; age?: number; gender?: string; createdAt?: string }>> {
    const cgId = this.getCaregiverId();
    if (!cgId) throw new Error('User not authenticated');

    try {
      const patients: Array<{ id: string; name?: string; photo?: string; age?: number; gender?: string; createdAt?: string }> = [];
      
      // Get patients from the patients subcollection
      const patientsRef = collection(this.firestore, 'caregiver', cgId, 'patients');
      const patientsSnapshot = await getDocs(patientsRef);
      
      for (const patientDoc of patientsSnapshot.docs) {
        const patientId = patientDoc.id;
        const patientDocData = patientDoc.data();
        
        // Get patientInfo if it exists
        const patientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'patientInfo', 'details');
        const patientInfoSnap = await getDoc(patientInfoRef);
        
        const patientData: any = {
          id: patientId,
          createdAt: patientDocData['createdAt'] || patientDocData['createdAt']
        };
        
        if (patientInfoSnap.exists()) {
          const info = patientInfoSnap.data();
          patientData.name = info['name'] || patientDocData['name'] || undefined;
          patientData.age = info['age'] || patientDocData['age'] || undefined;
          patientData.gender = info['sex'] || info['gender'] || patientDocData['sex'] || patientDocData['gender'] || undefined;
          patientData.photo = info['photo'] || patientDocData['photo'] || undefined;
        } else {
          // Fallback: check patient document itself for data
          patientData.name = patientDocData['name'] || undefined;
          patientData.age = patientDocData['age'] || undefined;
          patientData.gender = patientDocData['sex'] || patientDocData['gender'] || undefined;
          patientData.photo = patientDocData['photo'] || undefined;
          
          // Also check if patientId matches caregiver's own ID and get their info
          if (patientId === cgId && !patientData.name) {
            const caregiverDoc = await getDoc(doc(this.firestore, 'caregiver', cgId));
            if (caregiverDoc.exists()) {
              const cgData = caregiverDoc.data();
              patientData.name = cgData['name'] || undefined;
              patientData.photo = cgData['photo'] || undefined;
            }
          }
        }
        
        // Include all patients, even if they don't have a name (UI will show "Unnamed Patient")
        patients.push(patientData);
      }
      
      // Also check if the caregiver themselves has patientInfo (they might be their own patient)
      const ownPatientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', cgId, 'patientInfo', 'details');
      const ownPatientInfoSnap = await getDoc(ownPatientInfoRef);
      
      // Only add caregiver as patient if they have patientInfo and aren't already in the list
      if (ownPatientInfoSnap.exists() && !patients.find(p => p.id === cgId)) {
        const info = ownPatientInfoSnap.data();
        const caregiverDoc = await getDoc(doc(this.firestore, 'caregiver', cgId));
        const cgData = caregiverDoc.exists() ? caregiverDoc.data() : {};
        
        patients.push({
          id: cgId,
          name: info['name'] || cgData['name'],
          age: info['age'],
          gender: info['sex'] || info['gender'],
          photo: info['photo'] || cgData['photo'],
          createdAt: cgData['createdAt']
        });
      }
      
      return patients;
    } catch (error) {
      console.error('Error getting patients:', error);
      throw error;
    }
  }

  /** Add a new patient to the caregiver's patients collection */
  async addPatient(patientData: {
    name: string;
    age?: number;
    gender?: string;
    dateOfBirth?: string;
    medicalId?: string;
    notes?: string;
    photo?: string;
  }): Promise<string> {
    const cgId = this.getCaregiverId();
    if (!cgId) throw new Error('User not authenticated');

    try {
      // Generate a unique patient ID
      const patientId = `patient_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      
      // Create patient document (can be empty, just to establish the path)
      const patientRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId);
      await setDoc(patientRef, {
        createdAt: new Date().toISOString(),
        createdBy: cgId
      });

      // Create patientInfo document
      const patientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'patientInfo', 'details');
      await setDoc(patientInfoRef, this.sanitizeForFirestore({
        name: patientData.name,
        age: patientData.age || null,
        sex: patientData.gender || null,
        dateOfBirth: patientData.dateOfBirth || null,
        medicalId: patientData.medicalId || null,
        notes: patientData.notes || null,
        photo: patientData.photo || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));

      // Initialize userProgress for the patient (with correct caregiver ID)
      await this.initializeUserProgress(patientId, cgId);

      return patientId;
    } catch (error) {
      console.error('Error adding patient:', error);
      throw error;
    }
  }

  /** Subscribe to patients list changes */
  subscribeToPatients(onChange: (patients: Array<{ id: string; name?: string; photo?: string; age?: number; gender?: string }>) => void): Unsubscribe {
    const cgId = this.getCaregiverId();
    if (!cgId) {
      console.warn('subscribeToPatients: no auth available');
      return () => {};
    }

    const patientsRef = collection(this.firestore, 'caregiver', cgId, 'patients');
    
    return onSnapshot(patientsRef, async (snapshot) => {
      const patients: Array<{ id: string; name?: string; photo?: string; age?: number; gender?: string }> = [];
      
      for (const patientDoc of snapshot.docs) {
        const patientId = patientDoc.id;
        const patientDocData = patientDoc.data();
        
        try {
          const patientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'patientInfo', 'details');
          const patientInfoSnap = await getDoc(patientInfoRef);
          
          const patientData: any = { id: patientId };
          
          if (patientInfoSnap.exists()) {
            const info = patientInfoSnap.data();
            patientData.name = info['name'] || patientDocData['name'] || undefined;
            patientData.age = info['age'] || patientDocData['age'] || undefined;
            patientData.gender = info['sex'] || info['gender'] || patientDocData['sex'] || patientDocData['gender'] || undefined;
            patientData.photo = info['photo'] || patientDocData['photo'] || undefined;
          } else {
            // Fallback: check patient document itself for data
            patientData.name = patientDocData['name'] || undefined;
            patientData.age = patientDocData['age'] || undefined;
            patientData.gender = patientDocData['sex'] || patientDocData['gender'] || undefined;
            patientData.photo = patientDocData['photo'] || undefined;
            
            // Also check if patientId matches caregiver's own ID
            if (patientId === cgId && !patientData.name) {
              const caregiverDoc = await getDoc(doc(this.firestore, 'caregiver', cgId));
              if (caregiverDoc.exists()) {
                const cgData = caregiverDoc.data();
                patientData.name = cgData['name'] || undefined;
                patientData.photo = cgData['photo'] || undefined;
              }
            }
          }
          
          // Include all patients, even if they don't have a name (UI will show "Unnamed Patient")
          patients.push(patientData);
        } catch (err) {
          console.warn(`Error loading patient ${patientId}:`, err);
        }
      }
      
      // Also check if caregiver themselves has patientInfo
      try {
        const ownPatientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', cgId, 'patientInfo', 'details');
        const ownPatientInfoSnap = await getDoc(ownPatientInfoRef);
        
        if (ownPatientInfoSnap.exists() && !patients.find(p => p.id === cgId)) {
          const info = ownPatientInfoSnap.data();
          const caregiverDoc = await getDoc(doc(this.firestore, 'caregiver', cgId));
          const cgData = caregiverDoc.exists() ? caregiverDoc.data() : {};
          
          patients.push({
            id: cgId,
            name: info['name'] || cgData['name'],
            age: info['age'],
            gender: info['sex'] || info['gender'],
            photo: info['photo'] || cgData['photo']
          });
        }
      } catch (err) {
        console.warn('Error checking own patientInfo:', err);
      }
      
      onChange(patients);
    });
  }

  /** Delete a patient and all their data */
  async deletePatient(patientId: string): Promise<void> {
    const cgId = this.getCaregiverId();
    if (!cgId) throw new Error('User not authenticated');

    try {
      // Delete patientInfo/details document
      const patientInfoRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'patientInfo', 'details');
      await deleteDoc(patientInfoRef);

      // Delete userProgress document if exists
      const userProgressRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'userProgress', 'progress');
      await deleteDoc(userProgressRef).catch(() => {});

      // Delete the main patient document
      const patientRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId);
      await deleteDoc(patientRef);

      // Clear local storage if this was the selected patient
      const selectedPatientId = localStorage.getItem('selectedPatientId');
      if (selectedPatientId === patientId) {
        localStorage.removeItem('selectedPatientId');
      }
    } catch (error) {
      console.error('Error deleting patient:', error);
      throw error;
    }
  }
}