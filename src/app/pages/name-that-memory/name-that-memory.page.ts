
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { ProgressPage } from '../progress/progress.page';

type Category = 'people' | 'places' | 'objects' | string;

interface RawCard {
  id?: string;
  label?: string;
  name?: string;
  image?: string;
  photo?: string;
  photoUrl?: string;
  imagePath?: string;
  category?: string;
}
interface GameCard {
  id?: string;
  label: string;
  image: string;
  audio?: string | null;
  duration?: number;
  category: Category;
}


const CATEGORIES_KEY = 'alala_custom_categories_v1';
const CARDS_PREFIX   = 'alala_cards_';

interface CustomCategory {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  createdAt?: number;
}
interface RawCustomCard {
  id: string;
  categoryId: string;
  type: 'photo' | 'video' | 'manual';
  src: string;
  label?: string;
  audio?: string | null;
  duration?: number;
  createdAt?: number;
}

type Selection =
  | { type: 'builtin'; value: 'people' | 'places' | 'objects' }
  | { type: 'custom'; value: string };

@Component({
  selector: 'app-name-that-memory',
  templateUrl: './name-that-memory.page.html',
  styleUrls: ['./name-that-memory.page.scss'],
  standalone: false,
})
export class NameThatMemoryPage implements OnInit, OnDestroy {
  
  isPatientMode = false;

  
  isCategoryPickerOpen = false;
  userCategories: CustomCategory[] = [];
  selectedFilter: Selection | null = null; 

  
  counts: {
    people: number;
    places: number;
    objects: number;
    custom: Record<string, number>;
  } = { people: 0, places: 0, objects: 0, custom: {} };

  
  allCards: GameCard[] = [];
  gameCards: GameCard[] = [];

  
  currentCard: GameCard | null = null;
  options: string[] = [];
  currentQuestion = 0;
  totalQuestions = 10;
  correctAnswers = 0;

  
  showResult = false;
  isCorrect = false;
  showGameComplete = false;

  
  private shouldCompleteAfterResult = false;

  
  skipCount = 0;
  skippedCardIds: string[] = [];
  private askedLabels = new Set<string>();
  private gameStartTime = 0;

  
  private categoriesWatchTimer: any = null;
  private lastCategoriesHash = '';

  private readonly DEFAULT_NAMES = [
    'Aurelia','Thaddeus','Isolde','Cassian','Mirella',
    'Osric','Linnea','Percival','Elowen','Soren',
    'Calliope','Evander','Brielle','Lucian','Marisol'
  ];

  private flashcardsUnsub?: any;
  private firebaseCards: GameCard[] = [];

  constructor(private router: Router, private firebaseService: FirebaseService) {}

  
  ngOnInit() {
    this.loadPatientModeFromStorage();
    this.userCategories = this.getAllUserCategories();
    this.computeCounts();
    this.attachFirebaseFlashcards();
    this.primeFromFirebaseOnce();
    this.openCategoryPicker(); 
    
    
    window.addEventListener('card-deleted', () => {
      this.computeCounts();
    });
  }

  ionViewWillEnter() {
    this.userCategories = this.getAllUserCategories();
    this.computeCounts();
    this.openCategoryPicker();
  }

  ngOnDestroy() {
    this.stopCategoriesWatcher();
    try { this.flashcardsUnsub?.(); } catch {}
    
    window.removeEventListener('card-deleted', () => {});
  }

  
  togglePatientMode() {
    this.isPatientMode = !this.isPatientMode;
    try { localStorage.setItem('patientMode', JSON.stringify(this.isPatientMode)); } catch {}
  }
  private loadPatientModeFromStorage() {
    try {
      const raw = localStorage.getItem('patientMode');
      this.isPatientMode = raw ? JSON.parse(raw) : false;
    } catch { this.isPatientMode = false; }
  }

  
  openCategoryPicker() {
    this.isCategoryPickerOpen = true;
    this.startCategoriesWatcher();
  }
  closeCategoryPicker() {
    this.isCategoryPickerOpen = false;
    this.stopCategoriesWatcher();
  }
  closePickerToHome() {
    this.closeCategoryPicker();
    this.router.navigate(['/home']);
  }

  chooseBuiltin(builtin: 'people' | 'places' | 'objects') {
    this.selectedFilter = { type: 'builtin', value: builtin };
    this.closeCategoryPicker();
    this.setupNewRun();
  }
  chooseCustom(categoryId: string) {
    this.selectedFilter = { type: 'custom', value: categoryId };
    this.closeCategoryPicker();
    this.setupNewRun();
  }

  
  private startCategoriesWatcher() {
    this.lastCategoriesHash = this.readCategoriesHash();
    this.stopCategoriesWatcher(); 
    this.categoriesWatchTimer = setInterval(() => {
      const h = this.readCategoriesHash();
      if (h !== this.lastCategoriesHash) {
        this.lastCategoriesHash = h;
        this.userCategories = this.getAllUserCategories();
        this.computeCounts();
      }
    }, 1000);
  }
  private stopCategoriesWatcher() {
    if (this.categoriesWatchTimer) {
      clearInterval(this.categoriesWatchTimer);
      this.categoriesWatchTimer = null;
    }
  }
  private readCategoriesHash(): string {
    try {
      const user = this.firebaseService.getCurrentUser();
      const userSpecificKey = user ? `${CATEGORIES_KEY}_${user.uid}` : CATEGORIES_KEY;
      const raw = localStorage.getItem(userSpecificKey) || '[]';
      return `${raw.length}:${raw}`;
    } catch { return '0'; }
  }

  
  private setupNewRun() {
    
    if (!this.selectedFilter) {
      this.openCategoryPicker();
      return;
    }

    
    this.allCards = this.loadCardsByFilter(this.selectedFilter);

    
    const seen = new Set<string>();
    this.gameCards = this.allCards.filter(c => {
      const key = `${c.category}::${(c.label || '').toLowerCase()}::${c.image}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !!c.label && !!c.image;
    });

    const uniqueCount = new Set(this.gameCards.map(c => c.label.toLowerCase())).size;
    this.totalQuestions = Math.min(10, Math.max(uniqueCount, 0));

    
    this.currentCard = null;
    this.options = [];
    this.currentQuestion = 0;
    this.correctAnswers = 0;
    this.skipCount = 0;
    this.skippedCardIds = [];
    this.showResult = false;
    this.isCorrect = false;
    this.showGameComplete = false;
    this.shouldCompleteAfterResult = false;
    this.askedLabels.clear();
    this.gameStartTime = Date.now();

    if (this.gameCards.length > 0 && this.totalQuestions > 0) {
      this.startNewQuestion();
    }
  }

  private loadCardsByFilter(filter: Selection): GameCard[] {
    
    const byCat = (cat: 'people' | 'places' | 'objects') => this.firebaseCards.filter(c => c.category === cat);
    const people = byCat('people').length > 0 ? byCat('people') : this.readCardsWithFallbacks('people');
    const places = byCat('places').length > 0 ? byCat('places') : this.readCardsWithFallbacks('places');
    const objects = byCat('objects').length > 0 ? byCat('objects') : this.readCardsWithFallbacks('objects');

    if (filter.type === 'builtin') {
      const cat = filter.value;
      const map: Record<'people' | 'places' | 'objects', GameCard[]> = {
        people, places, objects
      };
      return map[cat].map(c => ({ ...c, category: cat }));
    }

    
    if (filter.type === 'custom') {
      const id = filter.value;
      const cats = this.getAllUserCategories();
      const cat = cats.find(c => c.id === id);
      if (!cat) return [];
      const raw = this.readCustomCards(id).filter(c => c.type === 'photo');
      return raw
        .filter(r => !!r.label && !!r.src)
        .map(r => ({
          id: r.id,
          label: (r.label || 'Untitled').toString().trim(),
          image: (r.src || '').toString().trim(),
          audio: (r as any).audio || null,
          duration: (r as any).duration || 0,
          category: (cat.name || 'custom').toString().trim().toLowerCase()
        }));
    }

    return [];
  }

  private attachFirebaseFlashcards() {
    try {
      this.flashcardsUnsub?.();
      
      this.flashcardsUnsub = (this.firebaseService as any).subscribeToGameFlashcards?.((cards: any[]) => {
        
        const seen = new Set<string>();
        this.firebaseCards = (cards || [])
          .map((c: any) => ({
            id: c.id,
            label: (c.label || '').toString().trim(),
            image: (c.image || c.src || '').toString().trim(),
            audio: c.audio || null,
            duration: c.duration || 0,
            category: (c.category || '').toString().trim().toLowerCase() as Category
          }))
          .filter(c => !!c.label && !!c.image)
          .filter(c => { const k = `${c.category}::${c.label.toLowerCase()}::${c.image}`; if (seen.has(k)) return false; seen.add(k); return true; });

        
        this.cacheGameCardsLocally(this.firebaseCards);

        
        this.computeCounts();

        
        if (this.selectedFilter) this.setupNewRun();
      });
    } catch (e) {
      console.error('Failed to attach Firebase flashcards:', e);
    }
  }

  private async primeFromFirebaseOnce() {
    try {
      const initial = await (this.firebaseService as any).getGameFlashcardsOnce?.();
      if (Array.isArray(initial) && initial.length > 0) {
        
        this.firebaseCards = (initial as any).map((c: any) => ({
          id: c.id,
          label: c.label,
          image: c.image,
          category: (c.category || '').toString().trim().toLowerCase() as Category
        }));
      } else {
        
        const cached = (this.firebaseService as any).getCachedGameFlashcards?.() || [];
        if (cached.length > 0) {
          
          this.firebaseCards = cached.map((c: any) => ({ id: c.id, label: c.label, image: c.image, category: (c.category || '').toString().trim().toLowerCase() as Category }));
        }
      }
    } catch {}
  }

  
  private readCardsWithFallbacks(category: Category): GameCard[] {
    const keys = this.buildKeyCandidates(category);
    const result: GameCard[] = [];
    const seen = new Set<string>();

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      let arr: RawCard[] = [];
      try { arr = JSON.parse(raw); } catch { arr = []; }
      if (!Array.isArray(arr)) continue;

      for (const r of arr) {
        const card = this.normalizeCard(r, category);
        if (!card.label || !card.image) continue;
        const k = `${card.label.toLowerCase()}::${card.image}`;
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(card);
      }
    }
    return result;
  }

  private buildKeyCandidates(cat: string): string[] {
    const singular = cat.endsWith('s') ? cat.slice(0, -1) : cat;
    return [
      `${cat}Cards`, `${singular}Cards`,
      cat, `${cat}_cards`, `${singular}_cards`,
      `${cat}List`, `${singular}List`,
    ];
  }

  private normalizeCard(r: RawCard, category: Category): GameCard {
    const label = (r.label || r.name || '').toString().trim();
    const image = (r.image ?? r.photoUrl ?? r.photo ?? r.imagePath ?? '').toString();
    const audio = (r as any).audio || null;
    const duration = (r as any).duration || 0;
    return { id: r.id, label, image, audio, duration, category };
  }

  
  private getAllUserCategories(): CustomCategory[] {
    try {
      const user = this.firebaseService.getCurrentUser();
      const userSpecificKey = user ? `${CATEGORIES_KEY}_${user.uid}` : CATEGORIES_KEY;
      const raw = localStorage.getItem(userSpecificKey);
      const arr = raw ? (JSON.parse(raw) as CustomCategory[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  private readCustomCards(categoryId: string): RawCustomCard[] {
    try {
      const raw = localStorage.getItem(`${CARDS_PREFIX}${categoryId}`);
      return raw ? (JSON.parse(raw) as RawCustomCard[]) : [];
    } catch { return []; }
  }

  
  private loadCustomGameCards(): GameCard[] {
    const cats = this.getAllUserCategories();
    if (cats.length === 0) return [];

    const list: GameCard[] = [];
    for (const cat of cats) {
      const raw = this.readCustomCards(cat.id).filter(c => c.type === 'photo');
      for (const r of raw) {
        const label = (r.label || 'Untitled').toString().trim();
        const image = (r.src || '').toString().trim();
        if (!label || !image) continue;

        list.push({
          id: r.id,
          label,
          image,
          category: (cat.name || 'custom').toString().trim().toLowerCase()
        });
      }
    }
    return list;
  }

  
  private startNewQuestion() {
    if (this.currentQuestion >= this.totalQuestions || this.gameCards.length === 0) {
      this.endGame();
      return;
    }

    this.currentQuestion += 1;

    
    const pool = this.gameCards.filter(c => !this.askedLabels.has(c.label));
    const base = pool.length ? pool : this.gameCards;
    const card = base[Math.floor(Math.random() * base.length)];
    this.askedLabels.add(card.label);
    this.currentCard = card;

    
    const correct = card.label;
    const allOtherLabels = this.gameCards
      .filter(c => c.label !== correct)
      .map(c => c.label);

    
    const filtered = allOtherLabels.filter(l => !this.isSimilar(l, correct));
    const poolNames = this.shuffle([...filtered]);

    
    const userAllLabels = new Set(this.gameCards.map(c => this.normalizeToken(c.label)));
    const defaultFillers = this.DEFAULT_NAMES
      .filter(n => !this.isSimilarToAny(n, userAllLabels))
      .filter(n => !this.isSimilar(n, correct));
    while (poolNames.length < 3 && defaultFillers.length > 0) {
      poolNames.push(defaultFillers.shift()!);
    }

    const four = [correct, ...poolNames.slice(0, 3)];
    this.options = this.shuffle(four);
    this.showResult = false;
    this.isCorrect = false;
    this.shouldCompleteAfterResult = false;
  }

  selectAnswer(choice: string) {
    if (!this.currentCard) return;
    const correct = this.currentCard.label;
    this.isCorrect = this.isSimilar(choice, correct) || choice === correct;
    if (this.isCorrect) this.correctAnswers++;

    
    this.shouldCompleteAfterResult = (this.currentQuestion >= this.totalQuestions);
    this.showResult = true;
  }

  skipCurrent() {
    if (!this.currentCard) return;
    this.skipCount++;
    if (this.currentCard.id) this.skippedCardIds.push(this.currentCard.id);

    if (this.currentQuestion >= this.totalQuestions) {
      this.endGame();
    } else {
      this.startNewQuestion();
    }
  }

  continueGame() {
    this.showResult = false;

    if (this.shouldCompleteAfterResult || this.currentQuestion >= this.totalQuestions) {
      this.shouldCompleteAfterResult = false;
      this.endGame();
    } else {
      this.startNewQuestion();
    }
  }

  private getCategoryName(): string {
    if (!this.selectedFilter) return 'unknown';
    if (this.selectedFilter.type === 'builtin') {
      return this.selectedFilter.value;
    } else {
      
      const customCategory = this.userCategories.find(c => c.id === this.selectedFilter!.value);
      return customCategory ? customCategory.name.toLowerCase() : 'custom';
    }
  }

  async endGame() {
    
    const totalTimeSeconds = this.gameStartTime > 0 ? Math.round((Date.now() - this.gameStartTime) / 1000) : 0;

    
    const sessionData = {
      category: this.getCategoryName(),
      totalQuestions: this.totalQuestions,
      correctAnswers: this.correctAnswers,
      skipped: this.skipCount,
      totalTime: totalTimeSeconds,
      timestamp: Date.now()
    };

    
    try {
      await ProgressPage.saveGameSession(this.firebaseService, sessionData, (window as any).progressPageInstance);
      
    } catch (error) {
      console.error('Error saving Name That Memory session:', error);
    }

    
    try {
      const key = 'nameThatMemoryHistory';
      const history: any[] = JSON.parse(localStorage.getItem(key) || '[]');
      history.push({
        endedAt: new Date().toISOString(),
        totalQuestions: this.totalQuestions,
        correctAnswers: this.correctAnswers,
        skipCount: this.skipCount,
        skippedCardIds: this.skippedCardIds,
        filter: this.selectedFilter
      });
      localStorage.setItem(key, JSON.stringify(history));
    } catch {}

    this.showResult = false;
    this.showGameComplete = true;
  }

  finishGame() {
    this.showGameComplete = false;
    this.showResult = false;
    this.shouldCompleteAfterResult = false;
    this.router.navigate(['/home']);
  }

  playAgain() {
    
    this.setupNewRun();
  }

  goBack() {
    this.router.navigate(['/home']);
  }

  
  private getAnsweredCount(): number {
    if (this.totalQuestions <= 0) return 0;
    if (this.showGameComplete) return this.totalQuestions;
    if (this.showResult) return this.currentQuestion;
    return Math.max(0, this.currentQuestion - 1);
  }

  get progressPct(): number {
    if (this.totalQuestions <= 0) return 0;
    const pct = (this.getAnsweredCount() / this.totalQuestions) * 100;
    return Math.min(100, Math.max(0, Math.round(pct)));
  }

  
  imgSrc(card: GameCard | null): string {
    if (!card) return '';
    return card.image;
  }

  
  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private normalizeToken(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private isSimilar(a: string, b: string): boolean {
    const na = this.normalizeToken(a);
    const nb = this.normalizeToken(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) {
      if (Math.abs(na.length - nb.length) <= 2) return true;
    }
    const d = this.levenshtein(na, nb);
    if (Math.max(na.length, nb.length) <= 5) return d <= 1;
    return d <= 2;
  }

  private isSimilarToAny(name: string, normalizedUserSet: Set<string>): boolean {
    const n = this.normalizeToken(name);
    if (normalizedUserSet.has(n)) return true;
    for (const u of normalizedUserSet) {
      const d = this.levenshtein(n, u);
      if (Math.max(n.length, u.length) <= 5 ? d <= 1 : d <= 2) return true;
      if (n.includes(u) || u.includes(n)) {
        if (Math.abs(n.length - u.length) <= 2) return true;
      }
    }
    return false;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  
  private computeCounts() {
    
    const firebasePeople = this.firebaseCards.filter(c => c.category === 'people');
    const firebasePlaces = this.firebaseCards.filter(c => c.category === 'places');
    const firebaseObjects = this.firebaseCards.filter(c => c.category === 'objects');

    const localPeople = this.readCardsWithFallbacks('people');
    const localPlaces = this.readCardsWithFallbacks('places');
    const localObjects = this.readCardsWithFallbacks('objects');

    
    const mergeCounts = (firebase: GameCard[], local: GameCard[]) => {
      const seen = new Set<string>();
      const all = [...firebase, ...local];
      return all.filter(c => {
        const key = `${c.category}::${(c.label || '').toLowerCase()}::${c.image}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).length;
    };

    const customCounts: Record<string, number> = {};
    const cats = this.getAllUserCategories();
    for (const c of cats) {
      const list = this.readCustomCards(c.id).filter(r => r.type === 'photo' && r.label && r.src);
      customCounts[c.id] = list.length;
    }

    this.counts = {
      people: mergeCounts(firebasePeople, localPeople),
      places: mergeCounts(firebasePlaces, localPlaces),
      objects: mergeCounts(firebaseObjects, localObjects),
      custom: customCounts
    };
  }

  private cacheGameCardsLocally(cards: GameCard[]) {
    try {
      const user = this.firebaseService.getCurrentUser();
      const uid = user ? user.uid : 'anon';
      const cacheKey = `nameThatMemoryCache_${uid}`;
      localStorage.setItem(cacheKey, JSON.stringify(cards));
    } catch (e) {
      console.warn('Failed to cache game cards locally:', e);
    }
  }

  getCategoryIcon(category: CustomCategory): string {
    const iconMap: { [key: string]: string } = {
      'people': 'people-outline',
      'places': 'location-outline', 
      'objects': 'cube-outline',
      'default': 'grid-outline'
    };
    
    if (category.emoji) {
      const emojiToIcon: { [key: string]: string } = {
        '👥': 'people-outline',
        '🏠': 'home-outline',
        '📍': 'location-outline',
        '📦': 'cube-outline',
        '⭐': 'star-outline',
        '❤️': 'heart-outline',
        '🎯': 'target-outline',
        '🎨': 'color-palette-outline',
        '🎵': 'musical-notes-outline',
        '🍎': 'nutrition-outline',
        '🚗': 'car-outline',
        '📚': 'library-outline',
        '🎮': 'game-controller-outline',
        '🏆': 'trophy-outline',
        '💎': 'diamond-outline',
        '🎪': 'color-wand-outline'
      };
      
      return emojiToIcon[category.emoji] || iconMap[category.name?.toLowerCase()] || iconMap['default'];
    }
    
    return iconMap[category.name?.toLowerCase()] || iconMap['default'];
  }
}
