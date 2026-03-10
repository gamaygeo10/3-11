import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
  NgZone,
} from '@angular/core';
import { ActionSheetController, AlertController, Platform, ToastController } from '@ionic/angular';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { FirebaseService } from '../../services/firebase.service';
import { MediaService } from '../../services/media.service';
import { Location } from '@angular/common';

interface VideoMeta {
  id: string;
  path: string;
  label?: string;
  createdAt: number;
  poster?: string;
  thumbnail?: string;
  thumb?: string;
}
interface VideoView extends VideoMeta { src: string; }



@Component({
  selector: 'app-video-memories',
  templateUrl: './video-memories.page.html',
  styleUrls: ['./video-memories.page.scss'],
  standalone: false,
})
export class VideoMemoriesPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('cameraInput') cameraInput!: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') galleryInput!: ElementRef<HTMLInputElement>;
  @ViewChild('reels') reelsEl?: ElementRef<HTMLElement>;
  @ViewChildren('vidRef') vidRefs!: QueryList<ElementRef<HTMLVideoElement>>;
  @ViewChild('detailVideoRef') detailVideoRef!: ElementRef<HTMLVideoElement>;

  isPatientMode = false;
  private patientModeListener?: (e: any) => void;

  
  videos: VideoView[] = [];

  
  displayVideos: VideoView[] = [];

  
  progress: Array<{ current: number; duration: number }> = [];

  
  editingIndex: number | null = null;   
  editLabel = '';

  
  private expandedTitleIndex: number | null = null;

  
  private cancelPressed = false;
  private scrollEndTimer: any = null;
  private isJumping = false;
  private currentDisplayIndex = 0;

  
  private syncInterval: any = null;
  private lastSyncTime = 0;

  
  showDetailModal = false;
  selectedVideo: VideoView | null = null;
  selectedVideoIndex = -1;
  isDetailVideoPlaying = false;
  detailVideoCurrent = 0;
  detailVideoDuration = 0;

  constructor(
    private _plt: Platform,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private actionSheetCtrl: ActionSheetController,
    private alertCtrl: AlertController,
    private firebaseService: FirebaseService,
    private mediaService: MediaService,
    private location: Location,
    private toastCtrl: ToastController,
  ) {}

  
  readonly placeholderDataUrl: string = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" width="160" height="90">
      <rect width="16" height="9" fill="#0b0b0b" />
      <circle cx="8" cy="4.5" r="3" fill="rgba(255,255,255,0.03)" />
      <polygon points="6,3.2 6,5.8 9,4.5" fill="#ffffff" />
    </svg>
  `);

  
  onThumbError(ev: Event, video?: VideoView) {
    try {
      const img = ev?.target as HTMLImageElement | null;
      if (img) img.src = this.placeholderDataUrl;
      if (video) video.poster = this.placeholderDataUrl;
      this.cdr.detectChanges();
    } catch (e) {  }
  }

  
  onThumbVideoError(ev: Event, video?: VideoView) {
    try {
      const vid = ev?.target as HTMLVideoElement | null;
      if (vid) {
        try { vid.pause(); } catch {}
        
        vid.poster = this.placeholderDataUrl;
        vid.src = '';
      }
      if (video) {
        video.poster = this.placeholderDataUrl;
        
        video.src = '';
      }
      this.cdr.detectChanges();
    } catch (e) {  }
  }

  

  async refreshVideos() {
    try {
      
      
      const toast = await this.toastCtrl.create({
        message: 'Refreshing videos...',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
      
      
      this.attachVideosSubscription();
      
      const successToast = await this.toastCtrl.create({
        message: 'Videos refreshed!',
        duration: 2000,
        position: 'bottom',
        color: 'success'
      });
      await successToast.present();
    } catch (error) {
      console.error(' Refresh failed:', error);
      const errorToast = await this.toastCtrl.create({
        message: 'Refresh failed. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await errorToast.present();
    }
  }

  async manualSyncVideos() {
    try {
      
      
      const toast = await this.toastCtrl.create({
        message: 'Syncing videos with Cloudinary...',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
      
      
      const result = await this.firebaseService.syncVideosWithCloudinary();
      
      
      await this.firebaseService.syncDeletionsFromCloudinary();
      
      if (result.added > 0 || result.updated > 0 || result.deleted > 0) {
        await this.showSyncNotification(result);
        
        
        setTimeout(() => {
          this.attachVideosSubscription();
        }, 1000);
      } else {
        const noChangesToast = await this.toastCtrl.create({
          message: 'All videos are already synchronized',
          duration: 2000,
          position: 'bottom',
          color: 'success'
        });
        await noChangesToast.present();
      }
    } catch (error) {
      console.error(' Manual sync failed:', error);
      const errorToast = await this.toastCtrl.create({
        message: 'Sync failed. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await errorToast.present();
    }
  }

  async ngOnInit() {
    this.syncPatientMode();
    this.patientModeListener = (e: any) => {
      this.zone.run(() => {
        this.isPatientMode = !!e?.detail;
        this.cdr.detectChanges();
      });
    };
    window.addEventListener('patientMode-changed', this.patientModeListener);
    
    
    window.addEventListener('video-added', this.onVideoAdded as any);
    
    
    window.addEventListener('videos-synced', this.onVideosSynced as any);
    
    
    window.addEventListener('video-deleted-universal', this.onVideoDeletedUniversal as any);
    
    
    window.addEventListener('smooth-ui-refresh', this.onSmoothUIRefresh as any);
    
    
    window.addEventListener('immediate-ui-refresh', this.onImmediateUIRefresh as any);
    
    
    window.addEventListener('ultra-aggressive-ui-refresh', this.onUltraAggressiveUIRefresh as any);
    
    
    
    setTimeout(async () => {
        
        const currentUser = this.firebaseService.getCurrentUser();
        if (currentUser) {
          
          
          
          this.attachVideosSubscription();
          
          
          this.startPeriodicRefresh();
          
          
          this.startPeriodicCloudinarySync();
        } else {
          console.warn('️ User not authenticated, skipping video setup');
          
          this.videos = [];
          this.rebuildDisplay();
          this.prepareProgress();
          this.cdr.detectChanges();
        }
    }, 1000); 
    
    
    this.rebuildDisplay();
    this.prepareProgress();
  }

  ngAfterViewInit(): void {
    
    this.vidRefs.forEach(ref => {
      const v = ref.nativeElement;
      v.muted = true;
      v.loop = true;
      v.addEventListener('ended', () => { v.currentTime = 0; v.play().catch(() => {}); });
    });

    
    setTimeout(() => {
      const startDisplay = this.videos.length > 1 ? 1 : 0;
      this.jumpToPage(startDisplay);
    }, 0);
  }

  ionViewWillEnter() {
    this.syncPatientMode();
    this.cdr.detectChanges();
    
    this.triggerInstantDetection();
  }

  
  onScroll(event: any): void {
    
    this.triggerInstantDetection();
  }

  
  private startPeriodicCloudinarySync(): void {
    
    
    
    this.syncDeletionsFromCloudinary();
    
    
    setInterval(() => {
      this.syncDeletionsFromCloudinary();
    }, 200); 
    
    
    setInterval(() => {
      this.syncDeletionsFromCloudinary();
    }, 100); 
    
    
    setInterval(() => {
      this.syncDeletionsFromCloudinary();
    }, 50); 
  }

  
  private async syncDeletionsFromCloudinary(): Promise<void> {
    try {
      
      
      
      await this.firebaseService.detectAndSyncCloudinaryDeletions();
      
      
      this.forceImmediateLocalStateUpdate();
      
      
      this.forceImmediateUIRefresh();
      
    } catch (error) {
      console.error(' Cloudinary sync failed:', error);
    }
  }

  
  private triggerInstantDetection(): void {
    
    setTimeout(() => {
      this.syncDeletionsFromCloudinary();
    }, 200); 
  }

  
  private forceImmediateUIRefresh(): void {
    
    
    
    setTimeout(() => {
      this.attachVideosSubscription();
    }, 100);
    
    
    setTimeout(() => {
      this.rebuildDisplay();
      this.prepareProgress();
      this.cdr.detectChanges();
    }, 200);
    
    
    setTimeout(() => {
      this.rebuildDisplay();
      this.prepareProgress();
      this.cdr.detectChanges();
    }, 500);
  }

  
  private async forceImmediateLocalStateUpdate(): Promise<void> {
    try {
      
      
      
      const firebaseVideos = await this.firebaseService.debugGetVideos();
      
      
      if (firebaseVideos.length === 0) {
        
        return;
      }
      
      const videosToRemove: any[] = [];
      
      
      for (const firebaseVideo of firebaseVideos) {
        if (!firebaseVideo.downloadURL && !firebaseVideo.videoURL) {
          continue;
        }
        
        const videoUrl = firebaseVideo.downloadURL || firebaseVideo.videoURL;
        
        try {
          
          const response = await fetch(videoUrl, { method: 'HEAD' });
          if (!response.ok) {
            
            videosToRemove.push(firebaseVideo);
          }
        } catch (error) {
          
        }
      }
      
      
      if (videosToRemove.length > 0) {
        
        
        for (const videoToRemove of videosToRemove) {
          const index = this.videos.findIndex(v => v.id === videoToRemove.id);
          if (index !== -1) {
            this.videos.splice(index, 1);
            
          }
        }
        
        
        this.rebuildDisplay();
        this.prepareProgress();
        this.cdr.detectChanges();
        
        
      }
      
    } catch (error) {
      console.error(' Failed to force immediate local state update:', error);
    }
  }

  ngOnDestroy(): void {
    if (this.patientModeListener) {
      window.removeEventListener('patientMode-changed', this.patientModeListener);
    }
    window.removeEventListener('video-added', this.onVideoAdded as any);
    window.removeEventListener('videos-synced', this.onVideosSynced as any);
    window.removeEventListener('video-deleted-universal', this.onVideoDeletedUniversal as any);
    window.removeEventListener('smooth-ui-refresh', this.onSmoothUIRefresh as any);
    window.removeEventListener('immediate-ui-refresh', this.onImmediateUIRefresh as any);
    window.removeEventListener('ultra-aggressive-ui-refresh', this.onUltraAggressiveUIRefresh as any);
    this.detachVideosSubscription();
    this.stopPeriodicSync();
  }

  private syncPatientMode() {
    this.isPatientMode = localStorage.getItem('patientMode') === 'true';
  }

  

  private rebuildDisplay() {
    if (this.videos.length <= 1) {
      this.displayVideos = this.videos.slice();
    } else {
      const first = this.videos[0];
      const last = this.videos[this.videos.length - 1];
      this.displayVideos = [last, ...this.videos, first];
    }
    this.cdr.detectChanges();
  }

  
  private makeLoopDisplay(list: VideoView[]): VideoView[] {
    if (!list || list.length <= 1) return (list || []).slice();
    const first = list[0];
    const last = list[list.length - 1];
    return [last, ...list, first];
  }

  
  realIndex(displayIndex: number): number {
    const n = this.videos.length;
    if (n <= 1) return Math.max(0, Math.min(displayIndex, n - 1));
    if (displayIndex === 0) return n - 1;       
    if (displayIndex === n + 1) return 0;       
    return displayIndex - 1;                    
  }

  private reelsHeight(): number {
    return this.reelsEl?.nativeElement.clientHeight || 0;
  }

  onReelsScroll() {
    if (this.isJumping) return;
    if (this.scrollEndTimer) clearTimeout(this.scrollEndTimer);
    
    this.scrollEndTimer = setTimeout(() => this.onScrollSettled(), 120);
  }

  private onScrollSettled() {
    const el = this.reelsEl?.nativeElement;
    if (!el) return;
    const h = this.reelsHeight();
    if (h <= 0) return;

    
    const page = Math.round(el.scrollTop / h);
    const n = this.videos.length;

    if (n > 1) {
      
      if (page === 0) { this.jumpToPage(n); return; }       
      if (page === n + 1) { this.jumpToPage(1); return; }   
    }

    this.currentDisplayIndex = page;
    this.autoplayVisible(page);
  }

  private jumpToPage(page: number) {
    const el = this.reelsEl?.nativeElement;
    const h = this.reelsHeight();
    if (!el || h <= 0) return;
    this.isJumping = true;
    el.scrollTo({ top: page * h, behavior: 'auto' });
    this.currentDisplayIndex = page;
    this.autoplayVisible(page);
    
    setTimeout(() => { this.isJumping = false; }, 0);
  }

  private autoplayVisible(displayIndex: number) {
    this.vidRefs?.forEach((ref, i) => {
      const v = ref.nativeElement;
      if (i === displayIndex) v.play().catch(() => {});
      else v.pause();
    });
  }

  

  async openAddMenu() {
    if (this.isPatientMode) return;
    const sheet = await this.actionSheetCtrl.create({
      header: 'Add Video',
      buttons: [
        { text: 'Record with Camera', icon: 'camera', handler: () => this.cameraInput?.nativeElement.click() },
        { text: 'Pick from Gallery', icon: 'folder-open', handler: () => this.selectVideoFromGallery() },
        { text: 'Pick from Files', icon: 'document', handler: () => this.galleryInput?.nativeElement.click() },
        { text: 'Cancel', role: 'cancel', icon: 'close' },
      ],
    });
    await sheet.present();
  }

  onCancelMouseDown() { this.cancelPressed = true; }

  onInputBlur(realIdx: number) {
    if (this.cancelPressed) {
      this.cancelPressed = false;
      this.cancelEdit();
      return;
    }
    this.saveEdit(realIdx);
  }

  async onFilePicked(event: Event, _source: 'camera' | 'gallery') {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files.length) return;

    const file = input.files[0];
    
    
    const isValidDuration = await this.validateVideoDuration(file);
    if (!isValidDuration) {
      input.value = '';
      return;
    }
    
    const suggested = (file.name || '').replace(/\.[^.]+$/, '');
    const label = await this.promptForName('Add video name (optional)', suggested);

    try {
      
      const saved = await this.saveVideoFile(file, (label ?? '').trim() || undefined);
      
      
      setTimeout(() => this.jumpToPage(this.videos.length > 1 ? 1 : 0), 0);
      input.value = '';
      
      
      const toast = await this.toastCtrl.create({
        message: 'Video saved successfully!',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('Failed to save video:', error);
      const toast = await this.toastCtrl.create({
        message: 'Failed to save video. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  
  async selectVideoFromGallery() {
    try {
      
      
      const result = await this.mediaService.pickVideoFile();
      
      
      
      let file: File;
      
      if (result.base64) {
        
        const response = await fetch(result.base64);
        const blob = await response.blob();
        file = new File([blob], result.fileName || 'video.mp4', { type: result.mimeType });
      } else if (result.url) {
        
        const response = await fetch(result.url);
        const blob = await response.blob();
        file = new File([blob], result.fileName || 'video.mp4', { type: result.mimeType });
      } else {
        throw new Error('No valid video data received');
      }
      
      
      const isValidDuration = await this.validateVideoDuration(file);
      if (!isValidDuration) {
        return;
      }
      
      const suggested = (result.fileName || '').replace(/\.[^.]+$/, '');
      const label = await this.promptForName('Add video name (optional)', suggested);

      try {
        
        const saved = await this.saveVideoFile(file, (label ?? '').trim() || undefined);
        
        
        setTimeout(() => this.jumpToPage(this.videos.length > 1 ? 1 : 0), 0);
        
        
        const toast = await this.toastCtrl.create({
          message: 'Video saved successfully!',
          duration: 2000,
          position: 'bottom'
        });
        await toast.present();
      } catch (error) {
        console.error('Failed to save video:', error);
        const toast = await this.toastCtrl.create({
          message: 'Failed to save video. Please try again.',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
      
    } catch (error) {
      console.error(' Video selection failed:', error);
      const toast = await this.toastCtrl.create({
        message: 'Failed to select video. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  

  startEdit(displayIdx: number) {
    if (this.isPatientMode) return;
    const ri = this.realIndex(displayIdx);
    this.editingIndex = ri;
    this.editLabel = (this.videos[ri].label || '').trim();
  }

  onEditLabelInput(ev: any) {
    const val = ev?.detail?.value ?? ev?.target?.value ?? '';
    this.editLabel = val;
  }

  async saveEdit(realIdx: number) {
    if (this.editingIndex !== realIdx) return;
    const newLabel = (this.editLabel || '').trim();
    const video = this.videos[realIdx];
    
    try {
      
      await this.firebaseService.updateVideoMetadata(video.id, { title: newLabel || undefined });
      
      
      this.videos[realIdx].label = newLabel || undefined;
      this.editingIndex = null;
      this.editLabel = '';
      
      
      const toast = await this.toastCtrl.create({
        message: 'Video title updated!',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
      
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Failed to update video title:', error);
      const toast = await this.toastCtrl.create({
        message: 'Failed to update video title. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  cancelEdit() {
    this.editingIndex = null;
    this.editLabel = '';
  }

  

  isTitleExpanded(displayIdx: number): boolean {
    return this.expandedTitleIndex === displayIdx;
  }

  onTitleTap(displayIdx: number) {
    if (!this.isPatientMode) {
      this.startEdit(displayIdx);
      return;
    }
    this.expandedTitleIndex = (this.expandedTitleIndex === displayIdx) ? null : displayIdx;
  }

  

  async deleteVideo(displayIdx: number) {
    if (this.isPatientMode) return;
    const ri = this.realIndex(displayIdx);
    const item = this.videos[ri];
    if (!item) return;

    const confirm = await this.alertCtrl.create({
      header: 'Delete video?',
      message: 'This will remove the video from your device.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive' },
      ],
      backdropDismiss: true,
    });
    await confirm.present();
    const res = await confirm.onDidDismiss();
    if (res.role !== 'destructive') return;

    try { await Filesystem.deleteFile({ path: item.path, directory: Directory.Data }); } catch {}

    this.videos.splice(ri, 1);
    this.prepareProgress();
    this.rebuildDisplay();

    if (this.expandedTitleIndex === displayIdx) this.expandedTitleIndex = null;

    await this.persistMetadata();
    this.cdr.detectChanges();

    
    setTimeout(() => this.jumpToPage(this.videos.length > 1 ? 1 : 0), 0);
  }

  

  onLoadedMeta(displayIdx: number) {
    const v = this.getVideo(displayIdx);
    if (!v) return;
    const dur = isFinite(v.duration) ? v.duration : 0;
    const ri = this.realIndex(displayIdx);
    this.ensureProgressIndex(ri);
    this.progress[ri].duration = dur > 0 ? dur : 0;
  }

  onTimeUpdate(displayIdx: number) {
    const v = this.getVideo(displayIdx);
    if (!v) return;
    const ri = this.realIndex(displayIdx);
    this.ensureProgressIndex(ri);
    this.progress[ri].current = v.currentTime || 0;
    if (!this.progress[ri].duration && isFinite(v.duration)) {
      this.progress[ri].duration = v.duration || 0;
    }
  }

  onSeek(ev: CustomEvent, displayIdx: number) {
    const value = (ev.detail as any).value ?? 0;
    const v = this.getVideo(displayIdx);
    if (!v) return;
    v.currentTime = Number(value) || 0;
    const ri = this.realIndex(displayIdx);
    this.ensureProgressIndex(ri);
    this.progress[ri].current = v.currentTime;
  }

  onVideoTap(displayIdx: number) {
    const v = this.getVideo(displayIdx);
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  isPlaying(displayIdx: number): boolean {
    const v = this.getVideo(displayIdx);
    return !!v && !v.paused && !v.ended && v.currentTime > 0;
  }

  formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const m = Math.floor(sec / 60);
    return `${m}:${s}`;
  }

  
  
  private async validateVideoDuration(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        const duration = video.duration;
        
        
        if (duration > 60) {
          this.showVideoDurationError();
          resolve(false);
        } else {
          resolve(true);
        }
      };
      
      video.onerror = () => {
        console.error('Error loading video metadata');
        resolve(false);
      };
      
      video.src = URL.createObjectURL(file);
    });
  }
  
  private async showVideoDurationError() {
    const alert = await this.alertCtrl.create({
      header: 'Video Too Long',
      message: 'Videos must be 60 seconds or less. Please select a shorter video.',
      buttons: ['OK'],
      cssClass: 'video-duration-alert'
    });
    await alert.present();
  }

  

  private prepareProgress() {
    this.progress = this.videos.map(() => ({ current: 0, duration: 0 }));
  }

  private async persistMetadata() {
    
    
  }

  private async restoreFromStorage() {
    
    
    
  }

  private async saveVideoFile(file: File, label?: string): Promise<VideoView> {
    try {
      
      
      
      const uploadResult = await this.firebaseService.uploadVideoToCloudinaryFixed(file, label);
      
      
      
      const createdAt = Date.now();
      const meta: VideoMeta = { 
        id: uploadResult.id, 
        path: '', 
        label: uploadResult.title, 
        createdAt,
        poster: uploadResult.thumbnailUrl 
      };

      
      const videoView: VideoView = { 
        ...meta, 
        src: uploadResult.videoUrl 
      };

      

      
      const isSaved = await this.firebaseService.verifyVideoSaved(uploadResult.id);
      if (!isSaved) {
        console.error(' Video was not saved to Firestore!');
        throw new Error('Video upload failed - not saved to database');
      }
      

      
      window.dispatchEvent(new CustomEvent('video-added', { detail: { meta, src: uploadResult.videoUrl } }));

      return videoView;
    } catch (error) {
      console.error(' Cloudinary video upload failed:', error);
      
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(' Detailed error:', errorMessage);
      
      throw new Error(`Failed to save video: ${errorMessage}`);
    }
  }

  

  private onVideoAdded = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      if (!detail || !detail.meta || !detail.src) { 
        
        return; 
      }
      const newVid: VideoView = { 
        id: detail.meta.id,
        path: detail.meta.path,
        label: detail.meta.label,
        createdAt: detail.meta.createdAt,
        poster: detail.meta.poster || detail.meta.thumbnailUrl || detail.thumbnail || detail.thumb,
        src: detail.src || detail.meta.videoUrl || detail.meta.downloadURL || detail.meta.videoURL || detail.url
      };
      
      if (this.videos.some(v => v.id === newVid.id)) return;
      this.videos.unshift(newVid);
      
      if (!newVid.poster && newVid.src) {
        this.generateThumbnailFromVideo(newVid.src).then((dataUrl) => {
          if (dataUrl) {
            newVid.poster = dataUrl;
            this.cdr.detectChanges();
          }
        }).catch(() => {});
      }
      this.displayVideos = this.makeLoopDisplay(this.videos);
      this.progress.unshift({ current: 0, duration: 0 });
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error handling video added event:', error);
    }
  }

  private onVideoDeletedUniversal = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      
      
      if (detail?.videoId) {
        
        const videoIndex = this.videos.findIndex(v => v.id === detail.videoId);
        if (videoIndex !== -1) {
          this.videos.splice(videoIndex, 1);
          
          
          
          this.rebuildDisplay();
          this.prepareProgress();
          this.cdr.detectChanges();
          
          
          if (this.selectedVideo && this.selectedVideo.id === detail.videoId) {
            this.closeDetailView();
          }
          
          
          const message = detail.cloudinaryDeleted && detail.firebaseDeleted 
            ? 'Video deleted from all platforms' 
            : 'Video deleted (some platforms may have failed)';
          
          this.toastCtrl.create({
            message,
            duration: 2000,
            position: 'bottom',
            color: detail.cloudinaryDeleted && detail.firebaseDeleted ? 'success' : 'warning'
          }).then(toast => toast.present());
        }
      }
    } catch (error) {
      console.error(' Error handling universal deletion event:', error);
    }
  };

  private onImmediateUIRefresh = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      
      
      
      this.forceImmediateUIRefresh();
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 50); 
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 200); 
      
    } catch (error) {
      console.error(' Error handling immediate UI refresh event:', error);
    }
  };

  private onSmoothUIRefresh = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 300); 
      
    } catch (error) {
      console.error(' Error handling smooth UI refresh event:', error);
    }
  };

  private onUltraAggressiveUIRefresh = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      
      
      
      this.forceImmediateUIRefresh();
      
      
      this.forceImmediateLocalStateUpdate();
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 10); 
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 50); 
      
      
      setTimeout(() => {
        this.attachVideosSubscription();
      }, 100); 
      
    } catch (error) {
      console.error(' Error handling ultra-aggressive UI refresh event:', error);
    }
  };

  private onVideosSynced = (e: CustomEvent) => {
    try {
      const detail: any = (e as any).detail;
      
      
      
      if (Array.isArray(detail?.deletedIds) && detail.deletedIds.length > 0) {
        const ids: string[] = detail.deletedIds;
        let removed = 0;
        ids.forEach(id => {
          const idx = this.videos.findIndex(v => v.id === id);
          if (idx !== -1) {
            this.videos.splice(idx, 1);
            removed++;
          }
        });
        if (removed > 0) {
          this.prepareProgress();
          this.rebuildDisplay();
          this.showSyncNotification({ added: 0, updated: 0, deleted: removed } as any).catch(() => {});
        }
      }

      
      if (detail.added > 0 || detail.updated > 0) {
        this.showSyncNotification(detail);
        setTimeout(() => { this.attachVideosSubscription(); }, 1000);
      }
    } catch (error) {
      console.error('Error handling videos synced event:', error);
    }
  }

  private async showSyncNotification(syncResult: { added: number; updated: number; deleted: number }) {
    const message = `Sync complete: ${syncResult.added} added, ${syncResult.updated} updated, ${syncResult.deleted} deleted`;
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'bottom',
      color: 'success'
    });
    await toast.present();
  }

  private startPeriodicRefresh() {
    
    this.stopPeriodicSync();
    
    
    this.syncInterval = setInterval(async () => {
      try {
        
        
        this.attachVideosSubscription();
        this.lastSyncTime = Date.now();
      } catch (error) {
        console.error(' Periodic refresh failed:', error);
      }
    }, 30000); 
    
    
  }

  private stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      
    }
  }

  private videosUnsub?: any;

  private attachVideosSubscription() {
    try {
      this.detachVideosSubscription();
      
      
      
      const currentUser = this.firebaseService.getCurrentUser();
      if (!currentUser) {
        console.warn('️ No authenticated user, skipping video subscription');
        
        this.videos = [];
        this.rebuildDisplay();
        this.prepareProgress();
        this.cdr.detectChanges();
        return;
      }
      
      this.videosUnsub = this.firebaseService.subscribeToVideos((items: any[]) => {
        
        
        
        
        this.updateVideosSmoothly(items || []);
      });
    } catch (error) {
      console.error(' Failed to subscribe to Firebase videos:', error);
      
      this.videos = [];
      this.rebuildDisplay();
      this.prepareProgress();
      this.cdr.detectChanges();
    }
  }

  
  private updateVideosSmoothly(newVideos: any[]) {
    try {
      
      
      
      
      const firebaseVideos: VideoView[] = newVideos.map((v: any) => ({
        id: v.id,
        path: '', 
        label: v.label || v.title || v.name,
        createdAt: v.createdAt || v.timestamp || Date.now(),
        
        src: v.downloadURL || v.videoURL || v.videoUrl || v.video || v.src || v.url,
        
        poster: v.thumbnailUrl || v.thumbnail || v.thumb || v.poster
      }));

      
      

      
      const videosChanged = this.haveVideosChanged(this.videos, firebaseVideos);
      
      if (!videosChanged) {
        
        return;
      }

      
      const previousCount = this.videos.length;
      const newCount = firebaseVideos.length;
      
      
      
      
      this.videos = firebaseVideos.sort((a, b) => b.createdAt - a.createdAt);
      
      
      this.rebuildDisplay();
      this.prepareProgress();
      
      
      requestAnimationFrame(() => {
        this.cdr.detectChanges();
        
        
        this.generateThumbnailsForVideos();
        
        
        
      });
      
    } catch (error) {
      console.error(' Error in smooth video update:', error);
    }
  }

  
  private haveVideosChanged(oldVideos: VideoView[], newVideos: VideoView[]): boolean {
    if (oldVideos.length !== newVideos.length) {
      return true;
    }
    
    
    for (let i = 0; i < oldVideos.length; i++) {
      const oldVideo = oldVideos[i];
      const newVideo = newVideos[i];
      
      if (oldVideo.id !== newVideo.id || 
          oldVideo.src !== newVideo.src || 
          oldVideo.label !== newVideo.label) {
        return true;
      }
    }
    
    return false;
  }

  
  private generateThumbnailsForVideos() {
    this.videos.forEach((vid) => {
      if (!vid.poster && vid.src) {
        this.generateThumbnailFromVideo(vid.src).then((dataUrl) => {
          if (dataUrl) {
            vid.poster = dataUrl;
            this.cdr.detectChanges();
          }
        }).catch((err) => {
          
          console.debug('Thumbnail generation failed for', vid.id, err);
        });
      }
    });
  }
  private detachVideosSubscription() {
    try { if (this.videosUnsub) this.videosUnsub(); } catch {}
    this.videosUnsub = undefined;
  }

  

  private getVideo(displayIdx: number): HTMLVideoElement | null {
    const ref = this.vidRefs?.get(displayIdx);
    return ref?.nativeElement ?? null;
  }

  private ensureProgressIndex(realIdx: number) {
    if (!this.progress[realIdx]) this.progress[realIdx] = { current: 0, duration: 0 };
  }

  private async promptForName(header: string, value: string): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header,
      inputs: [{ name: 'label', type: 'text', placeholder: '(optional)', value }],
      buttons: [{ text: 'Skip', role: 'cancel' }, { text: 'Save', role: 'confirm' }],
      backdropDismiss: true,
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm') return null;
    return (data?.values?.label ?? '') as string;
  }

  
  private generateThumbnailFromVideo(videoUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const video = document.createElement('video') as HTMLVideoElement;
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';
        video.src = videoUrl;

        const cleanup = () => {
          try { video.pause(); } catch {}
          video.src = '';
        };

        const onLoaded = () => {
          try {
            video.currentTime = 0.05; 
          } catch (err) {
            
          }
        };

        const onSeeked = () => {
          try {
            const canvas = document.createElement('canvas') as HTMLCanvasElement;
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 180;
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanup(); resolve(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            cleanup();
            resolve(dataUrl);
          } catch (err) {
            cleanup();
            resolve(null);
          }
        };

        const onError = () => { cleanup(); resolve(null); };

        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });

        
        const fallback = setTimeout(() => {
          try {
            const canvas = document.createElement('canvas') as HTMLCanvasElement;
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 180;
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanup(); resolve(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            cleanup();
            resolve(dataUrl);
          } catch (err) {
            cleanup();
            resolve(null);
          }
        }, 1500);

        
      } catch (e) {
        resolve(null);
      }
    });
  }

  
  openDetailView(video: VideoView, index: number) {
    this.selectedVideo = video;
    this.selectedVideoIndex = index;
    this.showDetailModal = true;
    this.editLabel = video.label || '';
  }

  closeDetailView() {
    this.showDetailModal = false;
    this.selectedVideo = null;
    this.selectedVideoIndex = -1;
    this.isDetailVideoPlaying = false;
    this.detailVideoCurrent = 0;
    this.detailVideoDuration = 0;
  }

  onDetailVideoLoaded() {
    const video = this.detailVideoRef?.nativeElement;
    if (video) {
      this.detailVideoDuration = video.duration || 0;
    }
  }

  onDetailVideoTimeUpdate() {
    const video = this.detailVideoRef?.nativeElement;
    if (video) {
      this.detailVideoCurrent = video.currentTime || 0;
    }
  }

  toggleDetailVideoPlay() {
    const video = this.detailVideoRef?.nativeElement;
    if (!video) return;

    if (this.isDetailVideoPlaying) {
      video.pause();
      this.isDetailVideoPlaying = false;
    } else {
      video.play().then(() => {
        this.isDetailVideoPlaying = true;
      }).catch(() => {
        this.isDetailVideoPlaying = false;
      });
    }
  }

  onDetailVideoSeek(event: CustomEvent) {
    const video = this.detailVideoRef?.nativeElement;
    if (!video) return;

    const value = Number(event.detail?.value || 0);
    video.currentTime = value;
    this.detailVideoCurrent = value;
  }

  async deleteVideoFromGallery(index: number) {
    if (this.isPatientMode) return;

    const video = this.videos[index];
    if (!video) return;

    const alert = await this.alertCtrl.create({
      header: 'Delete Video',
      message: `Remove "${video.label || 'this video'}" from your memories?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => this.performDeleteVideo(index) }
      ]
    });
    await alert.present();
  }

  private async performDeleteVideo(index: number) {
    try {
      const video = this.videos[index];
      if (!video) return;

      
      try {
        const success = await this.firebaseService.universalDeleteVideo(video.id);
        
        if (success) {
          
          
          
          const toast = await this.toastCtrl.create({
            message: 'Video deleted from all platforms!',
            duration: 2000,
            position: 'bottom'
          });
          await toast.present();
          
          
          
        } else {
          throw new Error('Universal deletion returned false');
        }
      } catch (firebaseError: any) {
        console.error('Failed to delete video from Cloudinary:', firebaseError);
        const toast = await this.toastCtrl.create({
          message: 'Failed to delete video. Please try again.',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
        return; 
      }

      
      if (this.selectedVideo && this.selectedVideo.id === video.id) {
        this.closeDetailView();
      }

      this.cdr.detectChanges();
    } catch (error) {
      console.error('Failed to delete video:', error);
    }
  }

  goBack() {
    this.location.back();
  }

  
  goToPreviousVideo() {
    if (this.selectedVideoIndex > 0) {
      const prevIndex = this.selectedVideoIndex - 1;
      this.openDetailView(this.videos[prevIndex], prevIndex);
    }
  }

  goToNextVideo() {
    if (this.selectedVideoIndex < this.videos.length - 1) {
      const nextIndex = this.selectedVideoIndex + 1;
      this.openDetailView(this.videos[nextIndex], nextIndex);
    }
  }

  
  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  
  async editVideo(video: any) {
    if (!video) return;
    
    const alert = await this.alertCtrl.create({
      header: 'Edit Title',
      inputs: [
        {
          name: 'label',
          type: 'text',
          placeholder: 'Video title',
          value: video.label || ''
        }
      ],
      buttons: [
        {
          text: 'Done',
          handler: async (data) => {
            try {
              
              video.label = data.label;
              
              
              this.prepareProgress();
              this.rebuildDisplay();
              
              
              if (video.id) {
                await this.firebaseService.updateVideoMetadata(video.id, {
                  title: data.label
                });
              }
              
              await this.toast('Video updated', 'success');
            } catch (err) {
              console.error('Failed to update video:', err);
              await this.toast('Failed to update video', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  
  async deleteVideoFromDetail(video: any) {
    if (!video) return;
    
    const alert = await this.alertCtrl.create({
      header: 'Delete Video',
      message: `Remove "${video.label || 'this video'}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              
              if (video.id) {
                const success = await this.firebaseService.deleteVideoFromCloudinary(video.id);
                
                if (success) {
                  
                  
                  
                  this.closeDetailView();
                  
                  
                  const toast = await this.toastCtrl.create({
                    message: 'Video deleted successfully!',
                    duration: 2000,
                    position: 'bottom'
                  });
                  await toast.present();
                  
                  
                  setTimeout(() => {
                    this.attachVideosSubscription();
                  }, 1000);
                } else {
                  throw new Error('Deletion returned false');
                }
              }
            } catch (err) {
              console.error('Failed to delete video:', err);
              const toast = await this.toastCtrl.create({
                message: 'Failed to delete video. Please try again.',
                duration: 3000,
                position: 'bottom',
                color: 'danger'
              });
              await toast.present();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  private async toast(message: string, color: 'success' | 'warning' | 'danger' | 'primary' = 'primary') {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await t.present();
  }
}
