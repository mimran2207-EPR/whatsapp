import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    // Visual check against Figma "02 Components". Development builds only.
    path: '__ui',
    canMatch: [() => isDevMode()],
    loadComponent: () => import('./dev/ui-gallery.component').then((m) => m.UiGalleryComponent),
  },
  {
    path: 'login',
    title: 'כניסה · תקשורת לתושבים',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/layout/shell-layout.component').then((m) => m.ShellLayoutComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'בית · תקשורת לתושבים',
        data: { nav: 'home' },
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'campaigns',
        pathMatch: 'full',
        title: 'משלוחים · תקשורת לתושבים',
        data: { nav: 'campaigns' },
        loadComponent: () => import('./features/campaigns/list/campaign-list.component').then((m) => m.CampaignListComponent),
      },
      {
        path: 'campaigns/new',
        title: 'משלוח חדש · תקשורת לתושבים',
        data: { nav: 'campaigns' },
        loadComponent: () => import('./features/campaigns/wizard/wizard.component').then((m) => m.WizardComponent),
      },
      {
        path: 'campaigns/:id/edit',
        title: 'עריכת משלוח · תקשורת לתושבים',
        data: { nav: 'campaigns' },
        loadComponent: () => import('./features/campaigns/wizard/wizard.component').then((m) => m.WizardComponent),
      },
      {
        path: 'campaigns/:id/tracking',
        title: 'מעקב משלוח · תקשורת לתושבים',
        data: { nav: 'campaigns' },
        loadComponent: () => import('./features/campaigns/tracking/tracking.component').then((m) => m.TrackingComponent),
      },
      {
        path: 'approvals',
        title: 'אישורים · תקשורת לתושבים',
        data: { nav: 'home' },
        loadComponent: () => import('./features/approvals/approvals.component').then((m) => m.ApprovalsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
