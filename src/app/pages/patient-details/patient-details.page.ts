import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-patient-details',
  templateUrl: './patient-details.page.html',
  styleUrls: ['./patient-details.page.scss'],
  standalone: false
})
export class PatientDetailsPage implements OnInit {
  patientName: string = '';
  patientAge: string = '';
  patientSex: string = '';
  isLoading: boolean = false;
  userId: string = '';

  constructor(
    private router: Router,
    private firebaseService: FirebaseService
  ) {}

  ngOnInit() {
    
    this.userId = localStorage.getItem('userId') || '';
    if (!this.userId) {
      alert('User ID not found. Please sign up again.');
      this.router.navigate(['/signup']);
    }
  }

  async savePatientDetails() {
    
    const name = (this.patientName || '').trim();
    const age = (this.patientAge || '').toString().trim();
    const sex = (this.patientSex || '').trim();

    
    if (!name) {
      alert('Please enter the patient\'s name');
      return;
    }

    if (!age) {
      alert('Please enter the patient\'s age');
      return;
    }

    if (!sex) {
      alert('Please select the patient\'s sex');
      return;
    }

    
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 0 || ageNum > 150) {
      alert('Please enter a valid age (0-150)');
      return;
    }

    this.isLoading = true;

    try {
      
      const patientDetails = {
        name: name,
        age: ageNum,
        sex: sex
      };

      
      await this.firebaseService.savePatientDetails(patientDetails);

      
      localStorage.setItem('patientDetails', JSON.stringify(patientDetails));

      
      this.router.navigate(['/home']);

    } catch (error: any) {
      console.error('Error saving patient details:', error);
      alert(error.message || 'Failed to save patient details. Please try again.');
    } finally {
      this.isLoading = false;
    }
  }

  goBack() {
    this.router.navigate(['/signup']);
  }
}

