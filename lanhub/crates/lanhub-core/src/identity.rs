//! `<root>/.lan-collab/hub.json`, read and completed exactly as the Node hub's `loadIdentity` does. `id` is
//! the project's hubId: clients key their sync state on it, so a value written by hub 0.1 is kept.

use std::path::Path;

use lanhub_protocol::json::{self, JsStr, Json};

use crate::util::{iso_now, random_uuid};

pub struct Identity {
    pub hub_id: String,
    pub instance_id: String,
}

pub fn load(root: &Path) -> std::io::Result<Identity> {
    let file = root.join(".lan-collab").join("hub.json");
    let saved = std::fs::read(&file).ok().and_then(|b| json::parse(&b).ok());
    let mut members = match saved {
        Some(Json::Obj(m)) => m,
        _ => Vec::new(),
    };
    let get = |members: &[(JsStr, Json)], k: &str| -> Option<Json> {
        members
            .iter()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.clone())
            .filter(Json::truthy)
    };
    let id = get(&members, "id");
    let instance = get(&members, "instance");
    if let (Some(id), Some(instance)) = (&id, &instance) {
        return Ok(Identity {
            hub_id: id.to_js_string().to_utf8_lossy().into_owned(),
            instance_id: instance.to_js_string().to_utf8_lossy().into_owned(),
        });
    }
    let id = id.unwrap_or_else(|| Json::Str(random_uuid().into()));
    let instance = instance.unwrap_or_else(|| Json::Str(random_uuid().into()));
    // `{...saved, id, instance}` keeps a key's first position and appends new ones.
    for (k, v) in [("id", &id), ("instance", &instance)] {
        match members.iter_mut().find(|(key, _)| key == k) {
            Some(slot) => slot.1 = v.clone(),
            None => members.push((k.into(), v.clone())),
        }
    }
    if get(&members, "created").is_none() {
        match members.iter_mut().find(|(key, _)| key == "created") {
            Some(slot) => slot.1 = Json::Str(iso_now().into()),
            None => members.push(("created".into(), Json::Str(iso_now().into()))),
        }
    }
    std::fs::create_dir_all(file.parent().expect("hub.json has a parent"))?;
    let text = serde_json::to_string_pretty(&Json::Obj(members)).expect("JSON always serializes");
    std::fs::write(&file, text)?;
    Ok(Identity {
        hub_id: id.to_js_string().to_utf8_lossy().into_owned(),
        instance_id: instance.to_js_string().to_utf8_lossy().into_owned(),
    })
}

/// The hub's `instanceId` in multi-project mode: `<config folder>/instance.json`, created on first start.
pub fn load_instance(dir: &Path) -> std::io::Result<String> {
    let file = dir.join("instance.json");
    let saved = std::fs::read(&file).ok().and_then(|b| json::parse(&b).ok());
    if let Some(id) = saved
        .as_ref()
        .and_then(|s| s.get("instanceId"))
        .and_then(Json::as_str)
        .filter(|id| !id.is_empty())
    {
        return Ok(id.to_owned());
    }
    let id = random_uuid();
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "instanceId": id,
        "created": iso_now(),
    }))
    .expect("JSON always serializes");
    std::fs::create_dir_all(dir)?;
    crate::flush::write_file_atomic(&file, text.as_bytes())?;
    Ok(id)
}
