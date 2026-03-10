import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PatientsDashboardPageRoutingModule } from './patients-dashboard-routing.module';

import { PatientsDashboardPage } from './patients-dashboard.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PatientsDashboardPageRoutingModule
  ],
  declarations: [PatientsDashboardPage]
})
export class PatientsDashboardPageModule {}
