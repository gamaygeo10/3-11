import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { MediaAlbumsPageRoutingModule } from './media-albums-routing.module';
import { MediaAlbumsPage } from './media-albums.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MediaAlbumsPageRoutingModule
  ],
  declarations: [MediaAlbumsPage]
})
export class MediaAlbumsPageModule {}

