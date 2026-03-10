import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { FirebaseService } from '../../services/firebase.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

interface CaregiverInfo {
  name: string;
  email: string;
  phone?: string;
}

interface PatientInfo {
  name: string;
  age: number;
  gender?: string;
  username?: string;
}

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false
})
export class ProfilePage implements OnInit {
  
  caregiverInfo: CaregiverInfo | null = null;
  patientInfo: PatientInfo | null = null;
  accountCreated: Date | null = null;
  isPatientMode: boolean = false;
  patientId: string = '';

  constructor(
    private location: Location,
    private firebaseService: FirebaseService,
    private firestore: Firestore,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadProfileData();
    this.loadPatientInfo();
    this.checkPatientMode();
  }

  goBack() {
    this.location.back();
  }

  onPatientModeToggle() {
    window.dispatchEvent(new CustomEvent('caregiver-toggle'));
    this.router.navigate(['/home']).catch(err => {
      console.error('Navigation to home failed from profile page:', err);
    });
  }

  private async loadProfileData() {
    try {
      
      const user = await this.firebaseService.getCurrentUser();
      if (user) {
        this.caregiverInfo = {
          name: user.displayName || 'Caregiver',
          email: user.email || 'No email provided',
          phone: user.phoneNumber || undefined
        };
        
        
        if (user.metadata?.creationTime) {
          this.accountCreated = new Date(user.metadata.creationTime);
        }
      }
    } catch (error) {
    }
  }

  private async loadPatientInfo() {
    try {
      const user = await this.firebaseService.getCurrentUser();
      if (!user) {
        console.error('No user found');
        return;
      }

      // Get the correct patient ID (selected patient or current user)
      const selectedPatientId = localStorage.getItem('selectedPatientId');
      const patientId = selectedPatientId || user.uid;
      
      // Set patient ID display (first 8 characters, uppercase)
      this.patientId = patientId.substring(0, 8).toUpperCase();

      // Try to load from localStorage first (for quick display)
      const storedPatientInfo = localStorage.getItem('patientDetails');
      if (storedPatientInfo && !selectedPatientId) {
        // Only use localStorage if we're viewing the current user's own patient info
        try {
          const parsed = JSON.parse(storedPatientInfo);
          this.patientInfo = {
            name: parsed.name,
            age: parsed.age,
            gender: parsed.sex || parsed.gender, 
            username: parsed.username || undefined
          };
        } catch (e) {
          // If parsing fails, continue to load from Firestore
        }
      }

      // Load from Firestore (always fetch latest data)
      const cgId = user.uid;
      const patientDocRef = doc(this.firestore, 'caregiver', cgId, 'patients', patientId, 'patientInfo', 'details');
      const patientDoc = await getDoc(patientDocRef);
      
      if (patientDoc.exists()) {
        const patientData = patientDoc.data();
        this.patientInfo = {
          name: patientData['name'] || '',
          age: patientData['age'] || 0,
          gender: patientData['sex'] || patientData['gender'] || '', 
          username: patientData['username'] || undefined
        };
        
        // Update localStorage only if viewing own patient info
        if (!selectedPatientId) {
          localStorage.setItem('patientDetails', JSON.stringify({
            name: this.patientInfo.name,
            age: this.patientInfo.age,
            sex: this.patientInfo.gender,
            username: this.patientInfo.username
          }));
        }
      } else {
        // If no patient info found, try to get basic info from patient document
        const patientDocRef2 = doc(this.firestore, 'caregiver', cgId, 'patients', patientId);
        const patientDoc2 = await getDoc(patientDocRef2);
        
        if (patientDoc2.exists()) {
          const patientData2 = patientDoc2.data();
          this.patientInfo = {
            name: patientData2['name'] || 'Patient Name',
            age: patientData2['age'] || 0,
            gender: patientData2['sex'] || patientData2['gender'] || '',
            username: patientData2['username'] || undefined
          };
        }
      }
    } catch (error) {
      console.error('Error loading patient info:', error);
    }
  }

  private checkPatientMode() {
    
    const patientMode = localStorage.getItem('patientMode');
    this.isPatientMode = patientMode === 'true';
  }
}
