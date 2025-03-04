/*
* installer.ts
*
* Copyright (C) 2020-2022 Posit Software, PBC
*
*/
import { join } from "path/mod.ts";
import { emptyDirSync, ensureDirSync, walk } from "fs/mod.ts";
import { copySync } from "fs/copy.ts";
import { error, info } from "log/mod.ts";

import { Configuration } from "../common/config.ts";
import { runCmd } from "../util/cmd.ts";

export async function makeInstallerDeb(
  configuration: Configuration,
) {
  info("Building deb package...");

  // detect packaging machine architecture
  const result = await runCmd("dpkg-architecture", ["-qDEB_BUILD_ARCH"]);
  const architecture =
    (result.status.code === 0 ? result.stdout.trim() : undefined);
  if (!architecture) {
    error("Can't detect package architecture.");
    throw new Error("Undetectable architecture. Packaging failed.");
  }
  const packageName =
    `quarto-${configuration.version}-linux-${architecture}.deb`;
  info("Building package " + packageName);

  // Prepare working directory
  const workingDir = join(configuration.directoryInfo.out, "working");
  info(`Preparing working directory ${workingDir}`);
  ensureDirSync(workingDir);
  emptyDirSync(workingDir);

  // Copy bin into the proper path in working dir
  const workingBinPath = join(
    workingDir,
    "opt",
    configuration.productName.toLowerCase(),
    "bin",
  );
  info(`Preparing bin directory ${workingBinPath}`);
  copySync(configuration.directoryInfo.bin, workingBinPath, {
    overwrite: true,
  });

  const workingSharePath = join(
    workingDir,
    "opt",
    configuration.productName.toLowerCase(),
    "share",
  );
  info(`Preparing share directory ${workingSharePath}`);
  copySync(configuration.directoryInfo.share, workingSharePath, {
    overwrite: true,
  });

  const val = (name: string, value: string): string => {
    return `${name}: ${value}\n`;
  };

  // Calculate the install size
  const fileSizes = [];
  for await (const entry of walk(configuration.directoryInfo.dist)) {
    if (entry.isFile) {
      fileSizes.push((await Deno.stat(entry.path)).size);
    }
  }
  const size = fileSizes.reduce((accum, target) => {
    return accum + target;
  });
  const url = "https://github.com/quarto-dev/quarto-cli";
  // Make the control file
  info("Creating control file");
  let control = "";
  control = control + val("Package", configuration.productName);
  control = control + val("Version", configuration.version);
  control = control + val("Architecture", architecture);
  control = control + val("Installed-Size", `${Math.round(size / 1024)}`);
  control = control + val("Section", "user/text");
  control = control + val("Priority", "optional");
  control = control + val("Maintainer", "RStudio, PBC <quarto@rstudio.org>");
  control = control + val("Homepage", url);
  control = control +
    val(
      "Description",
      "Quarto is an academic, scientific, and technical publishing system built on Pandoc.",
    );
  info(control);

  // Place
  const debianDir = join(workingDir, "DEBIAN");
  ensureDirSync(debianDir);

  // Write the control file to the DEBIAN directory
  Deno.writeTextFileSync(join(debianDir, "control"), control);

  // Generate and write a copyright file
  info("Creating copyright file");
  const copyrightLines = [];
  copyrightLines.push(
    "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/",
  );
  copyrightLines.push("Upstream-Name: Quarto");
  copyrightLines.push(`Source: ${url}`);
  copyrightLines.push("");
  copyrightLines.push("Files: *");
  copyrightLines.push("Copyright: RStudio, PBC.");
  copyrightLines.push("License: GPL-2+");
  const copyrightText = copyrightLines.join("\n");
  Deno.writeTextFileSync(join(debianDir, "copyright"), copyrightText);

  // copy the install scripts
  info("Copying install scripts...");
  copySync(
    join(configuration.directoryInfo.pkg, "scripts", "linux", "deb"),
    debianDir,
    { overwrite: true },
  );

  await runCmd("dpkg-deb", [
    "-Z",
    "gzip",
    "-z",
    "9",
    "--build",
    workingDir,
    join(configuration.directoryInfo.out, packageName),
  ]);

  // Remove the working directory
  // Deno.removeSync(workingDir, { recursive: true });
}
