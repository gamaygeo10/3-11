import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import * as QRCode from 'qrcode';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false
})
export class SettingsPage implements OnInit {
  userData: any = {};
  qrCodeData = '';
  qrCodeImage = '';
  showQRCode = false;
  isPatientMode: boolean = false;

  
  securityCode = '';
  private USED_CODES_KEY = 'alala_used_security_codes_v1';
  private readonly CODE_LEN = 24;
  
  
  private readonly ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';

  
  hasPin = false;
  maskedPin = '—';
  revealedPin = '';
  showMasked = true;
  isEditingPassword = false;


  saving = false;

  
  form = { currentPin: '', newPin: '', confirmPin: '' };
  showCurrent = false;
  showNew = false;
  showConfirm = false;

  
  isEditingName = false;
  isEditingEmail = false;
  nameDraft = '';
  emailDraft = '';
  savingName = false;
  savingEmail = false;

  
  @ViewChild('cameraInput') cameraInput!: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') galleryInput!: ElementRef<HTMLInputElement>;

  
  trustedContacts: any[] = [];
  contactSecurityCode = '';
  isScanning = false;
  isAddingContact = false;

  
  expandedSections: { [key: string]: boolean } = {
    security: false,
    password: false,
    qr: false,
    contacts: false,
    options: false
  };

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private actionSheetCtrl: ActionSheetController,
    private firebaseService: FirebaseService
  ) {}

  async ngOnInit() {
    await this.loadUserDataFromFirebase();
    await this.loadPinState();
    this.loadTrustedContacts();
    this.checkPatientMode();
  }

  async loadUserDataFromFirebase() {
    try {
      const user = this.firebaseService.getCurrentUser();
      if (user) {
        const data = await this.firebaseService.getUserData(user.uid);
        this.userData = data || {};
        
        
        if (this.userData?.securityCode) {
          this.securityCode = String(this.userData.securityCode);
        } else {
          
          this.securityCode = user.uid;
          this.userData.securityCode = user.uid;
        }
        
        await this.generateQRData();
        return;
      }
    } catch {}
    
    this.loadUserData();
    if (this.userData?.securityCode) {
      this.securityCode = String(this.userData.securityCode);
    } else {
      this.ensureSecurityCode();
    }
    this.generateQRData();
  }

  

  loadUserData() {
    const stored = localStorage.getItem('userData');
    this.userData = stored ? JSON.parse(stored) : {};
  }

  async generateQRData() {
    const patientProfile = {
      type: 'patient-profile',
      appName: 'ALALA',
      name: this.userData.name || '',
      email: this.userData.email || '',
      sec: this.securityCode          
    };
    this.qrCodeData = JSON.stringify(patientProfile);
    try {
      this.qrCodeImage = await QRCode.toDataURL(this.qrCodeData, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
    } catch (error) {
      console.error('QR gen error', error);
    }
  }

  

  private async ensureSecurityCode() {
    const validRe = new RegExp(`^[${this.ALPHABET}]{${this.CODE_LEN}}$`);
    const existing = this.userData?.securityCode;

    if (typeof existing === 'string' && validRe.test(existing)) {
      this.securityCode = existing;
      this._addToUsedCodes(existing);
      return;
    }

    
    let code = '';
    const used = this._getUsedCodes();
    do {
      code = this.secureRandomFromAlphabet(this.CODE_LEN, this.ALPHABET);
    } while (used.includes(code));

    this.securityCode = code;
    this.userData = { ...(this.userData || {}), securityCode: code };
    
    
    try {
      const currentUser = this.firebaseService.getCurrentUser();
      if (currentUser) {
        await this.firebaseService.updateUserData(currentUser.uid, { securityCode: code });
      }
    } catch (error) {
      console.error('Failed to save security code to Firebase:', error);
    }
    
    localStorage.setItem('userData', JSON.stringify(this.userData));
    this._addToUsedCodes(code);
    window.dispatchEvent(new CustomEvent('user-profile-updated'));
  }

  private secureRandomFromAlphabet(len: number, alphabet: string): string {
    
    const out: string[] = [];
    const n = alphabet.length;
    const maxUnbiased = Math.floor(256 / n) * n; 

    const buf = new Uint8Array(len * 2); 
    while (out.length < len) {
      crypto.getRandomValues(buf);
      for (let i = 0; i < buf.length && out.length < len; i++) {
        const v = buf[i];
        if (v < maxUnbiased) {
          out.push(alphabet[v % n]);
        }
      }
    }
    return out.join('');
  }

  private _getUsedCodes(): string[] {
    try {
      const raw = localStorage.getItem(this.USED_CODES_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }
  private _addToUsedCodes(code: string) {
    const list = this._getUsedCodes();
    if (!list.includes(code)) {
      list.push(code);
      localStorage.setItem(this.USED_CODES_KEY, JSON.stringify(list));
    }
  }

  copySecurityCode() {
    if (!this.securityCode) return;
    navigator.clipboard?.writeText(this.securityCode)
      .then(() => this.toast('Security code copied', 'success'))
      .catch(() => {});
  }

  

  async openPhotoSheet() {
    const sheet = await this.actionSheetCtrl.create({
      header: 'Update Profile Picture',
      buttons: [
        { text: 'Take Photo', icon: 'camera', handler: () => this.cameraInput?.nativeElement.click() },
        { text: 'Choose from Gallery', icon: 'image', handler: () => this.galleryInput?.nativeElement.click() },
        { text: 'Cancel', role: 'cancel', icon: 'close' }
      ]
    });
    await sheet.present();
  }

  async onPhotoPicked(ev: Event, _source: 'camera' | 'gallery') {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    try {
      const dataUrl = await this.readFileAsDataURL(file);
      this.userData = { ...(this.userData || {}), photo: dataUrl };
      localStorage.setItem('userData', JSON.stringify(this.userData));
      window.dispatchEvent(new CustomEvent('user-profile-updated'));
      await this.generateQRData();
      await this.toast('Profile photo updated', 'success');
    } catch {
      await this.toast('Could not load image', 'danger');
    }
  }

  private readFileAsDataURL(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error('read error'));
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
  }

  

  beginNameEdit() {
    if (this.isEditingName) return;
    this.nameDraft = (this.userData.name || '').trim();
    this.isEditingName = true;
  }

  async saveName() {
    if (!this.isEditingName || this.savingName) return;
    this.savingName = true;

    const name = (this.nameDraft || '').trim();
    this.userData = { ...(this.userData || {}), name };
    localStorage.setItem('userData', JSON.stringify(this.userData));
    window.dispatchEvent(new CustomEvent('user-profile-updated'));
    await this.generateQRData();
    this.isEditingName = false;
    this.savingName = false;
    await this.toast('Name updated', 'success');
  }

  cancelNameEdit() {
    this.isEditingName = false;
    this.savingName = false;
    this.nameDraft = '';
  }

  

  beginEmailEdit() {
    if (this.isEditingEmail) return;
    this.emailDraft = (this.userData.email || '').trim();
    this.isEditingEmail = true;
  }

  async saveEmail() {
    if (!this.isEditingEmail || this.savingEmail) return;
    const email = (this.emailDraft || '').trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await this.toast('Please enter a valid email', 'warning');
      return;
    }

    this.savingEmail = true;
    this.userData = { ...(this.userData || {}), email };
    localStorage.setItem('userData', JSON.stringify(this.userData));
    window.dispatchEvent(new CustomEvent('user-profile-updated'));
    await this.generateQRData();
    this.isEditingEmail = false;
    this.savingEmail = false;
    await this.toast('Email updated', 'success');
  }

  cancelEmailEdit() {
    this.isEditingEmail = false;
    this.savingEmail = false;
    this.emailDraft = '';
  }

  

  async loadPinState() {
    try {
      const currentUser = this.firebaseService.getCurrentUser();
      if (!currentUser) {
        this.hasPin = false;
        this.maskedPin = '—';
        this.revealedPin = '';
        return;
      }

      const savedPin = await this.firebaseService.getCaregiverPassword(currentUser.uid);
      this.hasPin = !!savedPin;
      if (savedPin) {
        this.maskedPin = this.makeMask(savedPin.length);
        this.revealedPin = savedPin;
      } else {
        this.maskedPin = '—';
        this.revealedPin = '';
      }
    } catch (error) {
      console.error('Failed to load caregiver password:', error);
      this.hasPin = false;
      this.maskedPin = '—';
      this.revealedPin = '';
    }
  }

  makeMask(len: number) {
    const dots = Array(len).fill('•').join('');
    return len > 4 ? dots.replace(/(.{4})/g, '$1 ').trim() : dots;
  }

  async savePin() {
    if (this.saving) return;
    this.saving = true;

    try {
      const currentUser = this.firebaseService.getCurrentUser();
      if (!currentUser) {
        await this.toast('User not authenticated', 'danger');
        this.saving = false;
        return;
      }

      const savedPin = await this.firebaseService.getCaregiverPassword(currentUser.uid);

      if (savedPin) {
        if (!this.form.currentPin) {
          await this.toast('Enter your current password', 'warning');
          this.saving = false; return;
        }
        if (this.form.currentPin !== savedPin) {
          await this.toast('Current password is incorrect', 'danger');
          this.saving = false; return;
        }
      }

      if (!this.form.newPin || !this.form.confirmPin) {
        await this.toast('Enter and confirm the new password', 'warning');
        this.saving = false; return;
      }
      if (this.form.newPin.length < 4 || this.form.newPin.length > 32) {
        await this.toast('Password must be 4–32 characters', 'warning');
        this.saving = false; return;
      }
      if (this.form.newPin !== this.form.confirmPin) {
        await this.toast('New passwords do not match', 'danger');
        this.saving = false; return;
      }

      
      await this.firebaseService.setCaregiverPassword(currentUser.uid, this.form.newPin);
      
      this.form = { currentPin: '', newPin: '', confirmPin: '' };
      this.showCurrent = this.showNew = this.showConfirm = false;
      this.isEditingPassword = false; 

      this.loadPinState();
      await this.toast(savedPin ? 'Password updated' : 'Password set', 'success');
      
    } catch (error) {
      console.error('Failed to save caregiver password:', error);
      await this.toast('Failed to save password. Please try again.', 'danger');
    }
    
    this.saving = false;
  }

  async promptRemovePin() {
    const alert = await this.alertCtrl.create({
      header: 'Remove Password',
      message: 'Enter current password to remove it.',
      inputs: [{ name: 'pin', type: 'password', placeholder: 'Current password' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Remove', role: 'confirm', handler: (data) => this.removePin(data?.pin) }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  async removePin(inputPin?: string) {
    try {
      const currentUser = this.firebaseService.getCurrentUser();
      if (!currentUser) {
        await this.toast('User not authenticated', 'danger');
        return false;
      }

      const savedPin = await this.firebaseService.getCaregiverPassword(currentUser.uid);
      if (!savedPin) {
        await this.toast('No password to remove', 'warning');
        return false;
      }

      if (!inputPin || inputPin !== savedPin) {
        await this.toast('Incorrect password', 'danger');
        return false;
      }

      await this.firebaseService.removeCaregiverPassword(currentUser.uid);
      await this.loadPinState();
      await this.toast('Password removed', 'success');
      return true;
    } catch (error) {
      console.error('Failed to remove caregiver password:', error);
      await this.toast('Failed to remove password. Please try again.', 'danger');
      return false;
    }
  }

  toggleMask() {
    this.showMasked = !this.showMasked;
  }

  

  toggleQRCode() { this.showQRCode = !this.showQRCode; }

  goToPatientsDashboard() {
    this.router.navigate(['/patients-dashboard']);
  }

  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Logout',
      message: 'Do you want to log out?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Logout',
          role: 'destructive',
          handler: () => {
            this.confirmLogout();
          }
        }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  private async confirmLogout() {
    const confirmAlert = await this.alertCtrl.create({
      header: 'Are you sure?',
      message: 'You will be logged out of your account.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes, Logout',
          role: 'destructive',
          handler: async () => {
            try {
              await this.firebaseService.logout();
            } catch (e) {
              console.warn('Logout error (continuing redirect):', e);
            }

            try {
              localStorage.removeItem('userLoggedIn');
              localStorage.removeItem('userEmail');
              localStorage.removeItem('userId');
              localStorage.removeItem('userData');
              localStorage.removeItem('selectedPatientId');
            } catch {}

            this.router.navigate(['/login']);
          }
        }
      ],
      backdropDismiss: false
    });
    await confirmAlert.present();
  }

  async clearAllData() {
    const alert = await this.alertCtrl.create({
      header: 'Clear All Data',
      message: 'Remove all game progress? This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear',
          role: 'destructive',
          handler: () => {
            this.confirmClearAllData();
          }
        }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  private async confirmClearAllData() {
    const confirmAlert = await this.alertCtrl.create({
      header: 'Are you sure?',
      message: 'All your game progress will be permanently deleted.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes, Clear',
          role: 'destructive',
          handler: async () => {
            localStorage.removeItem('peopleCards');
            localStorage.removeItem('placesCards');
            localStorage.removeItem('objectsCards');
            localStorage.removeItem('gameSessions');
            localStorage.removeItem('patientDetails');
            await this.toast('All data cleared', 'success');
          }
        }
      ],
      backdropDismiss: false
    });
    await confirmAlert.present();
  }

  private async toast(message: string, color?: 'success' | 'warning' | 'danger' | 'primary' | 'medium') {
    const t = await this.toastCtrl.create({ message, duration: 1700, color: color || 'medium', position: 'top' });
    await t.present();
  }

  

  loadTrustedContacts() {
    try {
      const contacts = localStorage.getItem('trustedContacts');
      this.trustedContacts = contacts ? JSON.parse(contacts) : [];
    } catch (error) {
      console.error('Error loading trusted contacts:', error);
      this.trustedContacts = [];
    }
  }

  saveTrustedContacts() {
    try {
      localStorage.setItem('trustedContacts', JSON.stringify(this.trustedContacts));
    } catch (error) {
      console.error('Error saving trusted contacts:', error);
    }
  }

  async scanQRCode() {
    this.isScanning = true;
    try {
      
      const alert = await this.alertCtrl.create({
        header: 'QR Code Scanner',
        message: 'QR code scanning will be available in a future update. For now, please use the security code option.',
        buttons: ['OK']
      });
      await alert.present();
    } catch (error) {
      console.error('Error scanning QR code:', error);
      await this.toast('Error scanning QR code', 'danger');
    } finally {
      this.isScanning = false;
    }
  }

  async addContactByCode() {
    if (!this.contactSecurityCode.trim()) {
      await this.toast('Please enter a security code', 'warning');
      return;
    }

    this.isAddingContact = true;
    try {
      
      const existingContact = this.trustedContacts.find(c => c.securityCode === this.contactSecurityCode);
      if (existingContact) {
        await this.toast('This contact is already added', 'warning');
        return;
      }

      
      const familyNumber = this.trustedContacts.length + 1;
      const familyName = `FAMILY ${familyNumber}`;

      
      
      const mockContact = {
        id: Date.now().toString(),
        name: familyName,
        email: `family${familyNumber}@example.com`,
        photo: '',
        securityCode: this.contactSecurityCode,
        addedAt: new Date().toISOString(),
        familyNumber: familyNumber
      };

      this.trustedContacts.push(mockContact);
      this.saveTrustedContacts();
      this.contactSecurityCode = '';

      await this.toast(`${familyName} added successfully`, 'success');
    } catch (error) {
      console.error('Error adding contact:', error);
      await this.toast('Error adding contact', 'danger');
    } finally {
      this.isAddingContact = false;
    }
  }

  async removeContact(contactId: string) {
    const contactToRemove = this.trustedContacts.find(c => c.id === contactId);
    const familyName = contactToRemove?.name || 'Contact';

    const alert = await this.alertCtrl.create({
      header: 'Remove Contact',
      message: `Are you sure you want to remove ${familyName}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            this.trustedContacts = this.trustedContacts.filter(c => c.id !== contactId);
            
            this.renumberFamilyContacts();
            this.saveTrustedContacts();
            this.toast(`${familyName} removed`, 'success');
          }
        }
      ]
    });
    await alert.present();
  }

  private renumberFamilyContacts() {
    
    this.trustedContacts.forEach((contact, index) => {
      const newFamilyNumber = index + 1;
      contact.name = `FAMILY ${newFamilyNumber}`;
      contact.familyNumber = newFamilyNumber;
      contact.email = `family${newFamilyNumber}@example.com`;
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  async onPatientModeToggle() {
    if (!this.isPatientMode) {
      // Trying to enter patient mode
      await this.enablePatientMode();
      return;
    }
    // Already in patient mode - prompt to exit
    await this.promptExitPatientMode();
  }

  private async enablePatientMode() {
    try {
      const currentUser = this.firebaseService.getCurrentUser();
      if (!currentUser) {
        await this.toast('User not authenticated', 'danger');
        return;
      }

      const savedPin = await this.firebaseService.getCaregiverPassword(currentUser.uid);

      if (!savedPin) {
        const alert = await this.alertCtrl.create({
          header: 'Set Caregiver Password',
          message: 'To use Patient Mode, please create a caregiver password first. You can set it in the Caregiver Password section above.',
          buttons: [
            { text: 'OK', role: 'cancel' }
          ],
          backdropDismiss: false
        });
        await alert.present();
        return;
      }

      // Password exists - show confirmation
      const confirm = await this.alertCtrl.create({
        header: 'Enter Patient Mode?',
        message: 'Are you sure you want to switch to Patient Mode? You will need the caregiver password to exit.',
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Yes',
            handler: () => {
              // Set pending flag and navigate to home
              try { localStorage.setItem('pendingPatientMode', 'true'); } catch {}
              this.router.navigate(['/home']).catch(err => {
                console.error('Navigation to home failed from settings:', err);
              });
            }
          }
        ],
        backdropDismiss: false
      });
      await confirm.present();
    } catch (err) {
      console.error('Error enabling patient mode from settings:', err);
    }
  }

  private async promptExitPatientMode() {
    const currentUser = this.firebaseService.getCurrentUser();
    if (!currentUser) {
      await this.toast('User not authenticated', 'danger');
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Exit Patient Mode',
      message: 'Enter caregiver password to switch back to Standard mode.',
      inputs: [
        {
          name: 'pin',
          type: 'password',
          placeholder: 'Enter password',
          attributes: { maxlength: 32 }
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Unlock',
          handler: async (data) => {
            const savedPin = await this.firebaseService.getCaregiverPassword(currentUser.uid);
            if (data.pin === savedPin) {
              this.isPatientMode = false;
              localStorage.setItem('patientMode', 'false');
              await this.toast('Patient Mode disabled', 'success');
              window.dispatchEvent(new CustomEvent('patientMode-changed', { detail: false }));
              return true;
            } else {
              await this.toast('Incorrect password', 'danger');
              return false;
            }
          }
        }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  startPasswordEdit() {
    this.isEditingPassword = true;
    
    this.form = {
      currentPin: '',
      newPin: '',
      confirmPin: ''
    };
  }

  cancelPasswordEdit() {
    this.isEditingPassword = false;
    
    this.form = {
      currentPin: '',
      newPin: '',
      confirmPin: ''
    };
  }

  private checkPatientMode() {
    
    const patientMode = localStorage.getItem('patientMode');
    this.isPatientMode = patientMode === 'true';
  }

  goBack() {
    this.router.navigate(['/home']);
  }

  
  toggleSection(section: string) {
    this.expandedSections[section] = !this.expandedSections[section];
  }

  
  changePassword() {
    
    this.toast('Password change feature coming soon!', 'primary');
  }

  enableTwoFactor() {
    this.toast('Two-factor authentication coming soon!', 'primary');
  }

  viewLoginHistory() {
    this.toast('Login history feature coming soon!', 'primary');
  }

  async deletePatient() {
    const selectedPatientId = localStorage.getItem('selectedPatientId');
    if (!selectedPatientId) {
      await this.toast('No patient selected', 'warning');
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Delete Patient',
      message: 'Are you sure you want to delete this patient? This action cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.confirmDeletePatient(selectedPatientId);
          }
        }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  private async confirmDeletePatient(patientId: string) {
    const confirmAlert = await this.alertCtrl.create({
      header: 'Are you sure?',
      message: 'All patient data including progress, memories, and settings will be permanently deleted.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes, Delete',
          role: 'destructive',
          handler: async () => {
            try {
              await this.firebaseService.deletePatient(patientId);
              await this.toast('Patient deleted successfully', 'success');
              this.router.navigate(['/patients-dashboard']);
            } catch (error) {
              console.error('Error deleting patient:', error);
              await this.toast('Failed to delete patient. Please try again.', 'danger');
            }
          }
        }
      ],
      backdropDismiss: false
    });
    await confirmAlert.present();
  }

}
