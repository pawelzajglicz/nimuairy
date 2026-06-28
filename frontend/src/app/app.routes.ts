import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './guards/auth.guard';
import { LoginComponent } from './pages/login/login.component';
import { RegisterComponent } from './pages/register/register.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { CharacterListComponent } from './pages/character-list/character-list.component';
import { CharacterFormComponent } from './pages/character-form/character-form.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'characters', component: CharacterListComponent, canActivate: [authGuard] },
  { path: 'characters/new', component: CharacterFormComponent, canActivate: [authGuard] },
  { path: 'characters/:id/edit', component: CharacterFormComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'dashboard' }
];
