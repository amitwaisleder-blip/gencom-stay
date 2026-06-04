import Foundation

/// Wrapper around the on-device Core ML importance model.
///
/// Roadmap:
///   - Collect `BehaviorEvent`s via `BehaviorStore` (already in place).
///   - Periodically train/update a model on-device. Two viable paths:
///       a) Core ML + Create ML tabular regressor, retrained in the app, or
///       b) an updatable Core ML model using on-device personalization
///          (`MLUpdateTask`) seeded with a small base model shipped in the bundle.
///   - Load the resulting `.mlmodelc` here and run `predictImportance`.
///
/// Returning `loadIfAvailable() == nil` until a model is present is deliberate: the
/// `MessageRanker` then falls back to explainable rules, so the app is useful on
/// day one and gets smarter as it observes more behavior.
struct OnDeviceModel {
    /// Attempts to load a compiled Core ML model from the app bundle / on-device
    /// store. Returns nil when none has been trained yet.
    static func loadIfAvailable() -> OnDeviceModel? {
        // TODO(CoreML): locate compiled model (e.g. ImportanceRanker.mlmodelc),
        // instantiate it, and wrap it here. Return nil if not found.
        return nil
    }

    /// Map model features into a 0...1 importance probability.
    func predictImportance(_ features: MessageFeatures) -> Double {
        // TODO(CoreML): build an MLFeatureProvider from `features`, run prediction,
        // and return the calibrated importance probability.
        return 0.5
    }
}
