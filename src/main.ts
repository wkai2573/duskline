import './ui/styles.css';
import { createApp } from './ui/app.ts';

createApp(document.getElementById('app')!, document.getElementById('rules') as HTMLDialogElement);
