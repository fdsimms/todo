import ExpoModulesCore

// Foundation Models is iOS 26+ only and is weak-linked (see
// plugins/withFoundationModels.js) so this app keeps a pre-26 deployment
// target — every use of a symbol from it must be gated behind
// `if #available(iOS 26, *)`. Importing at file scope is always safe; it is
// *using* the symbols that must be guarded, and the containing project has to
// link against the iOS 26 SDK (Xcode 26+).
//
// NOTE: the exact signatures below were written against Apple's WWDC25
// "Meet the Foundation Models framework" material and public writeups, not a
// compiled iOS 26 SDK (unavailable in the sandbox this was written in) — the
// same caveat TodoAlarmKitModule.swift carries, for the same reason. Before
// shipping, verify every one against the real headers in Xcode 26 (Cmd-click
// into the framework) and adjust. Most likely candidates for drift:
//   - `SystemLanguageModel.default.availability` and the exact spelling of its
//     `.unavailable(reason:)` cases.
//   - `DynamicGenerationSchema.Property(name:schema:)` argument labels, and
//     whether the array root is built with `DynamicGenerationSchema(arrayOf:)`
//     or an explicit element/array pair.
//   - Whether `LanguageModelSession.respond(to:schema:)` takes the schema as
//     `GenerationSchema` or a generable type, and its exact return property.
#if canImport(FoundationModels)
import FoundationModels
#endif

private let logTag = "[TodoFoundationModels]"

/// Mirrors the `OnDeviceField` union in the module's index.ts. Decoded rather
/// than read key by key so a shape the TS side can't produce fails loudly here
/// instead of silently generating against a half-built schema.
private struct FieldSpec: Decodable {
  let name: String
  let type: String
  let choices: [String]?
  let description: String?
}

private struct SchemaSpec: Decodable {
  let name: String
  let description: String?
  let fields: [FieldSpec]
}

public class TodoFoundationModelsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoFoundationModels")

    // Synchronous, like the sibling bridges' `isAvailable`: a pure capability
    // check with no I/O, read at render time to decide whether a control
    // exists at all.
    Function("isAvailable") { () -> Bool in
      return availabilityString() == "available"
    }

    Function("availability") { () -> String in
      return availabilityString()
    }

    // Returns a JSON string rather than an array of dictionaries — the
    // convention the screen-time bridge already uses for structured payloads
    // in both directions, and the one that keeps this method's signature
    // stable as callers add fields. See the Bool-return note in
    // TodoWidgetBridgeModule.swift for why unbridged return types are worth
    // avoiding across the TurboModule boundary.
    AsyncFunction("generate") { (prompt: String, schemaJson: String) -> String in
      guard #available(iOS 26, *) else { return "[]" }
      #if canImport(FoundationModels)
      guard let specData = schemaJson.data(using: .utf8),
            let spec = try? JSONDecoder().decode(SchemaSpec.self, from: specData) else {
        NSLog("%@ could not decode the schema; returning nothing", logTag)
        return "[]"
      }

      var output = "[]"
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        TodoFoundationModelsExceptionCatcher.runCatchingExceptions {
          Task {
            do {
              let schema = try buildArraySchema(from: spec)
              let session = LanguageModelSession()
              let response = try await session.respond(to: prompt, schema: schema)
              output = jsonString(from: response.content, fields: spec.fields)
            } catch {
              // Includes the guardrail and context-window errors, which are
              // ordinary outcomes here rather than programmer error: a prompt
              // that overflows the small on-device window throws, and the
              // caller's answer for that is the same as for a refusal.
              NSLog("%@ generation failed: %@", logTag, String(describing: error))
              output = "[]"
            }
            continuation.resume()
          }
        }
      }
      return output
      #else
      return "[]"
      #endif
    }
  }
}

private func availabilityString() -> String {
  if #available(iOS 26, *) {
    #if canImport(FoundationModels)
    switch SystemLanguageModel.default.availability {
    case .available:
      return "available"
    case .unavailable(let reason):
      switch reason {
      case .deviceNotEligible: return "deviceNotEligible"
      case .appleIntelligenceNotEnabled: return "notEnabled"
      case .modelNotReady: return "notReady"
      @unknown default: return "unavailable"
      }
    @unknown default:
      return "unavailable"
    }
    #else
    return "unavailable"
    #endif
  }
  return "unavailable"
}

#if canImport(FoundationModels)
/// Builds `[{ field: value, ... }]` — every caller so far wants a list of rows,
/// and an array root keeps the JSON handed back to TS uniform.
@available(iOS 26, *)
private func buildArraySchema(from spec: SchemaSpec) throws -> GenerationSchema {
  var properties: [DynamicGenerationSchema.Property] = []
  for field in spec.fields {
    let valueSchema: DynamicGenerationSchema
    switch field.type {
    case "enum":
      // An empty choice list would constrain the model to nothing at all, so
      // it degrades to a free string rather than producing a schema that can
      // never be satisfied.
      if let choices = field.choices, !choices.isEmpty {
        valueSchema = DynamicGenerationSchema(name: field.name, anyOf: choices)
      } else {
        valueSchema = DynamicGenerationSchema(type: String.self)
      }
    default:
      valueSchema = DynamicGenerationSchema(type: String.self)
    }
    properties.append(
      DynamicGenerationSchema.Property(
        name: field.name,
        description: field.description,
        schema: valueSchema
      )
    )
  }

  let element = DynamicGenerationSchema(
    name: spec.name,
    description: spec.description,
    properties: properties
  )
  let root = DynamicGenerationSchema(arrayOf: element)
  return try GenerationSchema(root: root, dependencies: [element])
}

/// Reads the declared fields back out of `GeneratedContent` and re-encodes them
/// as JSON. Only the declared ones: the schema is what was asked for, and a key
/// the TS side didn't ask about has nothing waiting to validate it.
@available(iOS 26, *)
private func jsonString(from content: GeneratedContent, fields: [FieldSpec]) -> String {
  guard let elements = try? content.elements() else { return "[]" }
  var rows: [[String: String]] = []
  for element in elements {
    var row: [String: String] = [:]
    for field in fields {
      if let value = try? element.value(String.self, forProperty: field.name) {
        row[field.name] = value
      }
    }
    if !row.isEmpty { rows.append(row) }
  }
  guard let data = try? JSONSerialization.data(withJSONObject: rows),
        let json = String(data: data, encoding: .utf8) else { return "[]" }
  return json
}
#endif
