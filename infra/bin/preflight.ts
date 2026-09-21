#!/usr/bin/env node
import { loadConfig, validateDeploymentPreflight } from '../config/env';

validateDeploymentPreflight(loadConfig());
console.log('Themis AWS deployment preflight passed.');
