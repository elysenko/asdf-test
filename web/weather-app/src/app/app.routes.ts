import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./search-page.component').then((m) => m.SearchPageComponent),
  },
  { path: '**', redirectTo: '' },
];
