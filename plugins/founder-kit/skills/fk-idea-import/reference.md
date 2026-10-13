# fk-idea-import reference

## Share-link decoding
Most chat apps embed the conversation as JSON in the HTML. ChatGPT shares use a React Router turbo-stream: `streamController.enqueue("...")` chunks concatenate into a flat, deduplicated array where objects reference keys and values by index.
1. Decode into the object graph.
2. Find the object with `mapping` + `current_node`.
3. Walk parents up from `current_node`.
4. Keep only `user`/`assistant` messages whose `content_type` is text.
5. Guard against reference cycles with a visited set.
