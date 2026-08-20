#!/usr/bin/env bun
import { main } from "../src/cli/index";

const code = await main(process.argv.slice(2));
process.exit(code);
