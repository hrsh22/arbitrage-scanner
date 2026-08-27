/**
 * State Manager for Vault Post-Deploy One-Shot Flow
 *
 * Handles persistence of step completion to support resumable execution.
 * State is stored in `.vault-post-deploy-state.json`.
 *
 * Usage:
 *   const { loadState, saveState, clearState, isStepCompleted, markStepCompleted } = require('./lib/stateManager');
 *
 *   const state = loadState();
 *   if (isStepCompleted('step1')) { ... }
 *   markStepCompleted('step1', { txHash: '0x...' });
 *   clearState(); // On successful completion
 */

const fs = require("fs");
const path = require("path");

const STATE_FILE = ".vault-post-deploy-state.json";

/**
 * Get the full path to the state file
 * @returns {string} Path to state file
 */
function getStateFilePath() {
  return path.join(process.cwd(), STATE_FILE);
}

/**
 * Load existing state or return empty state
 * @returns {Object} State object with completedSteps array and metadata
 */
function loadState() {
  try {
    const statePath = getStateFilePath();
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, "utf8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`[StateManager] Warning: Could not load state file: ${error.message}`);
  }
  return {
    completedSteps: [],
    stepData: {},
    lastAttempt: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Save state to file with timestamp
 * @param {Object} state - State object to save
 */
function saveState(state) {
  try {
    const statePath = getStateFilePath();
    const stateWithMeta = {
      ...state,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(stateWithMeta, null, 2));
  } catch (error) {
    console.error(`[StateManager] Warning: Could not save state file: ${error.message}`);
  }
}

/**
 * Clear state file on successful completion
 * Deletes the entire state file
 */
function clearState() {
  try {
    const statePath = getStateFilePath();
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
      console.log(`[StateManager] State file cleared: ${STATE_FILE}`);
    }
  } catch (error) {
    console.error(`[StateManager] Warning: Could not clear state file: ${error.message}`);
  }
}

/**
 * Check if a step has already been completed
 * @param {string} step - Step name to check
 * @returns {boolean} True if step is completed
 */
function isStepCompleted(step) {
  const state = loadState();
  return state.completedSteps && state.completedSteps.includes(step);
}

/**
 * Mark a step as completed with optional data
 * @param {string} step - Step name to mark complete
 * @param {Object} data - Optional data to store with the step (e.g., txHash, timestamp)
 */
function markStepCompleted(step, data = {}) {
  const state = loadState();

  // Initialize completedSteps if not present
  if (!state.completedSteps) {
    state.completedSteps = [];
  }

  // Initialize stepData if not present
  if (!state.stepData) {
    state.stepData = {};
  }

  // Add step to completed list if not already there
  if (!state.completedSteps.includes(step)) {
    state.completedSteps.push(step);
  }

  // Store step-specific data
  state.stepData[step] = {
    ...data,
    completedAt: new Date().toISOString(),
  };

  // Update last attempt timestamp
  state.lastAttempt = new Date().toISOString();

  saveState(state);
  console.log(`[StateManager] Step marked complete: ${step}`);
}

/**
 * Get data stored for a specific step
 * @param {string} step - Step name to retrieve data for
 * @returns {Object|null} Step data or null if not found
 */
function getStepData(step) {
  const state = loadState();
  return state.stepData && state.stepData[step] ? state.stepData[step] : null;
}

/**
 * Get all completed steps
 * @returns {string[]} Array of completed step names
 */
function getCompletedSteps() {
  const state = loadState();
  return state.completedSteps || [];
}

/**
 * Get the last step that was attempted (for resuming)
 * @returns {string|null} Last step name or null
 */
function getLastStep() {
  const state = loadState();
  const steps = state.completedSteps || [];
  return steps.length > 0 ? steps[steps.length - 1] : null;
}

module.exports = {
  loadState,
  saveState,
  clearState,
  isStepCompleted,
  markStepCompleted,
  getStepData,
  getCompletedSteps,
  getLastStep,
};
