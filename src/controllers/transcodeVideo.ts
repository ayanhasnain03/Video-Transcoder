import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffProbeInstaller from "@ffprobe-installer/ffprobe";
import { NextFunction, Request, Response } from "express";
import ffmpeg from "fluent-ffmpeg";
import fs, { existsSync, mkdirSync, unlink } from "fs";
import { extname, resolve } from "path";
import HttpError from "../utils/HttpError";

export default async function transcodeVideo(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.file)
      return next(new HttpError("Upload a file to begin transcoding", 400));

    const outputDirName = req.file.originalname.split(
      extname(req.file.originalname)
    )[0];

    const inputFileName = req.file.originalname;
    const inputFilePath = resolve(__dirname, `../videos/raw/${inputFileName}`);
    const outputDir = resolve(
      __dirname,
      `../videos/transcoded/${outputDirName}`
    );
    const masterPlaylistPath = `${outputDir}/master.m3u8`;

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const resolutions = [
      {
        name: "1080p",
        width: 1920,
        height: 1080,
        bitrate: "5000k",
        bandwidth: 5000000,
      },
      {
        name: "720p",
        width: 1280,
        height: 720,
        bitrate: "2500k",
        bandwidth: 2500000,
      },
      {
        name: "480p",
        width: 854,
        height: 480,
        bitrate: "1000k",
        bandwidth: 1000000,
      },
      {
        name: "360p",
        width: 640,
        height: 360,
        bitrate: "600k",
        bandwidth: 600000,
      },
    ];

    let command = ffmpeg(inputFilePath)
      .setFfmpegPath(ffmpegInstaller.path)
      .setFfprobePath(ffProbeInstaller.path)
      .outputOptions("-preset veryfast")
      .outputOptions("-start_number 0")
      .outputOptions("-hls_list_size 0")
      .outputOptions("-hls_time 10");

    // Add subtitles (if available)
    const subtitlePath = resolve(
      __dirname,
      `../videos/subtitles/${outputDirName}.vtt`
    );
    if (existsSync(subtitlePath)) {
      command.outputOptions(`-vf subtitles=${subtitlePath}`);
    }

    resolutions.forEach(({ name, width, height, bitrate }) => {
      const resolutionDir = `${outputDir}/${name}`;
      if (!existsSync(resolutionDir)) {
        mkdirSync(resolutionDir, { recursive: true });
      }
      const outputPath = `${resolutionDir}/index.m3u8`;

      command
        .output(outputPath)
        .outputOptions(`-vf scale=${width}:${height}`)
        .outputOptions(`-b:v ${bitrate}`)
        .outputOptions("-c:v h264")
        .outputOptions("-c:a aac")
        .outputOptions("-strict -2")
        .outputOptions(
          "-hls_segment_filename",
          `${resolutionDir}/segment_%03d.ts`
        );
    });

    command.on("end", async () => {
      const masterPlaylist = resolutions
        .map(
          ({ name, bandwidth, width, height }) =>
            `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height}\n${name}/index.m3u8`
        )
        .join("\n");

      const subtitleEntry = existsSync(subtitlePath)
        ? `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="subtitles/${outputDirName}.vtt"`
        : "";

      const masterPlaylistContent = `#EXTM3U\n${subtitleEntry}\n${masterPlaylist}`;
      fs.writeFileSync(masterPlaylistPath, masterPlaylistContent);

      unlink(inputFilePath, (err) => {
        if (err) console.error("Error deleting raw file:", err);
      });

      res.status(200).json({
        message: "Transcoding completed",
        masterPlaylist: masterPlaylistPath,
      });
    });

    command.on("error", (err) => {
      console.error("FFmpeg error:", err);
      return next(new HttpError(`FFmpeg error: ${err.message}`, 500));
    });

    command.run();
  } catch (error) {
    console.error("Transcoding failed:", error);
    return next(
      new HttpError(`Transcoding failed: ${(error as Error).message}`, 500)
    );
  }
}
