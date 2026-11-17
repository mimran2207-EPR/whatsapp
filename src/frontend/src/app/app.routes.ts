import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    // Visual check against Figma "02 Components". Development builds only.
    path: '__ui',
    canMatch: [() => isDevMode()],
    loadComponent: () => import('./dev/ui-gallery.component').then((m) => m.UiGalleryComponent),
  },
];
