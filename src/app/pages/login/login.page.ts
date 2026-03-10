import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { QrService } from '../../services/qr.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email: string = '';
  password: string = '';
  isLoading: boolean = false;
  securityCode: string = '';

  constructor(
    private router: Router,
    private firebaseService: FirebaseService,
    private qrService: QrService
  ) {}

  async login() {
    if (!this.email || !this.password) {
      alert('Please enter email and password');
      return;
    }

    this.isLoading = true;
    
    try {
      const user = await this.firebaseService.login(this.email, this.password);
      
      
      const userData = await this.firebaseService.getUserData(user.uid);
      
      
      try {
        const lastUid = localStorage.getItem('userId');
        localStorage.removeItem('gameSessions');
        if (lastUid) localStorage.removeItem(`gameSessions:${lastUid}`);
        localStorage.removeItem('patientDetails');
        localStorage.removeItem('selectedPatientId'); // Clear selected patient on login
        ['peopleCards','placesCards','objectsCards'].forEach(k => localStorage.removeItem(k));
      } catch {}

      
      localStorage.setItem('userLoggedIn', 'true');
      localStorage.setItem('userEmail', this.email);
      localStorage.setItem('userId', user.uid);
      if (userData) {
        localStorage.setItem('userData', JSON.stringify(userData));
      }

      
      try { await this.firebaseService.ensureProgressInitialized(); } catch {}

      // Check if user is a caregiver and redirect to dashboard
      const userProfile = await this.firebaseService.getUserProfile(user.uid);
      // Redirect caregivers (or users with caregiver role or standard role) to dashboard
      if (userProfile?.role === 'caregiver' || !userProfile?.role || userProfile?.role === 'standard') {
        this.router.navigate(['/patients-dashboard']);
      } else {
        this.router.navigate(['/home']);
      }
      
    } catch (error: any) {
      alert(error.message || 'Login failed. Please try again.');
    } finally {
      this.isLoading = false;
    }
  }

  async onForgotPassword() {
    const email = (this.email || '').trim();
    if (!email) { alert('Enter your email first.'); return; }
    try {
      await this.firebaseService.sendPasswordReset(email);
      alert('Password reset email sent. Check your inbox.');
    } catch (e: any) {
      alert(e?.message || 'Could not send reset email.');
    }
  }

  goToSignup() {
    this.router.navigate(['/signup']);
  }

  async loginWithSecurityCode() {
    if (!this.securityCode) return;
    this.isLoading = true;
    try {
      await this.loginWithCode(this.securityCode);
    } catch (e) {
      alert('Failed to sign in with security code.');
    } finally {
      this.isLoading = false;
    }
  }

  async scanQRCode() {
    try {
      this.isLoading = true;
      const res = await this.qrService.scan();
      const text = (res?.text || '').trim();
      if (!text) { alert('No QR content detected.'); return; }
      let code = '';
      try { const obj = JSON.parse(text); code = (obj?.sec || obj?.securityCode || '').toString(); } catch { code = text; }
      if (!code) { alert('QR did not contain a valid security code.'); return; }
      await this.loginWithCode(code);
    } catch (e) {
      console.error('QR scan failed', e);
      alert('QR scan failed. Please enter the Security Code.');
    } finally {
      this.isLoading = false;
    }
  }


  private async loginWithCode(rawCode: string) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) throw new Error('Empty code');
    
    try {
      const found = await this.firebaseService.findUserBySecurityCode(code);
      if (!found) {
        alert('Security code not found.');
        return;
      }
      
      
      try {
        await this.firebaseService.logout();
      } catch (error) {
        console.warn('Logout failed (may not be signed in):', error);
      }
      
      
      localStorage.removeItem('userLoggedIn');
      localStorage.removeItem('userId');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userData');
      localStorage.removeItem('caregiverPin'); 
      localStorage.removeItem('patientDetails'); 
      
      
      localStorage.setItem('userLoggedIn', 'true');
      localStorage.setItem('userId', found.uid);
      if (found.email) localStorage.setItem('userEmail', found.email);
      
      
      
      const userData = {
        email: found.email || '',
        name: found.name || '',
        uid: found.uid
      };
      localStorage.setItem('userData', JSON.stringify(userData));
      
      
      
      // Check if user is a caregiver and redirect to dashboard
      try {
        const userProfile = await this.firebaseService.getUserProfile(found.uid);
        if (userProfile?.role === 'caregiver' || !userProfile?.role || userProfile?.role === 'standard') {
          this.router.navigate(['/patients-dashboard']);
          return;
        }
      } catch {
        // If error, default to home
      }
      
      this.router.navigate(['/home']);
      
    } catch (error) {
      console.error('Security code login failed:', error);
      alert('Login failed. Please try again.');
    }
  }
}

