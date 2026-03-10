import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { BrainGamesPageRoutingModule } from './brain-games-routing.module';
import { BrainGamesPage } from './brain-games.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BrainGamesPageRoutingModule
  ],
  declarations: [BrainGamesPage]
})
export class BrainGamesPageModule {}

