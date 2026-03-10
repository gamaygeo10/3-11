import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  standalone: false
})
export class SignupPage {
  name: string = '';
  email: string = '';
  phoneNumber: string = '';
  password: string = '';
  confirmPassword: string = '';
  isLoading: boolean = false;

  constructor(
    private router: Router,
    private firebaseService: FirebaseService
  ) {}

  async signup() {
    
    const name = (this.name || '').trim();
    const email = (this.email || '').trim();
    const phoneNumber = (this.phoneNumber || '').trim();
    const password = this.password || '';
    const confirmPassword = this.confirmPassword || '';

    
    if (!name) {
      alert('Please enter your full name');
      return;
    }

    if (!email) {
      alert('Please enter your email address');
      return;
    }

    if (!phoneNumber) {
      alert('Please enter your phone number');
      return;
    }

    if (!password) {
      alert('Please enter a password');
      return;
    }

    if (!confirmPassword) {
      alert('Please confirm your password');
      return;
    }

    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address');
      return;
    }

    
    const phoneRegex = /^\d{10,}$/;
    const phoneDigitsOnly = phoneNumber.replace(/\D/g, '');
    if (!phoneRegex.test(phoneDigitsOnly)) {
      alert('Please enter a valid phone number (at least 10 digits)');
      return;
    }

    
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    
    if (password.length === 0) {
      alert('Password cannot be empty');
      return;
    }

    this.isLoading = true;

    try {
      const user = await this.firebaseService.signup(email, password, name, phoneNumber);

      
      const userData = {
        name: name,
        email: email,
        phoneNumber: phoneNumber,
        createdAt: new Date().toISOString()
      };

      localStorage.setItem('userData', JSON.stringify(userData));
      localStorage.setItem('userLoggedIn', 'true');
      localStorage.setItem('userEmail', email);
      localStorage.setItem('userId', user.uid);

      
      try {
        localStorage.removeItem('patientDetails'); 
        ['peopleCards','placesCards','objectsCards'].forEach(k => localStorage.removeItem(k));
        ['peopleCards_'+user.uid,'placesCards_'+user.uid,'objectsCards_'+user.uid].forEach(k => localStorage.removeItem(k));
      } catch {}

      
      this.router.navigate(['/patients-dashboard']);

    } catch (error: any) {
      console.error('Signup error:', error);
      console.error('Error code:', error?.code);
      console.error('Error message:', error?.message);
      console.error('Full error:', JSON.stringify(error, null, 2));
      const code = error?.code || '';
      if (code === 'auth/email-already-in-use') {
        alert('This email is already in use. Please log in or use another email.');
      } else if (code === 'auth/weak-password') {
        alert('Password is too weak. Please use a stronger password.');
      } else if (code === 'auth/invalid-email') {
        alert('Invalid email address. Please try again.');
      } else if (error?.message?.includes('Missing or insufficient permissions')) {
        alert('Permission denied. Firestore rules may not be configured correctly. Please contact support.');
      } else {
        alert(error.message || 'Signup failed. Please try again.');
      }
    } finally {
      this.isLoading = false;
    }
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}
