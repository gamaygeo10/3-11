import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { MemoryCategoriesPageRoutingModule } from './memory-categories-routing.module';
import { MemoryCategoriesPage } from './memory-categories.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MemoryCategoriesPageRoutingModule
  ],
  declarations: [MemoryCategoriesPage]
})
export class MemoryCategoriesPageModule {}

